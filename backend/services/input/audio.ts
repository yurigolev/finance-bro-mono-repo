import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import { maxInputAudioSeconds } from '../../packages/contracts/input.ts'

type AudioValidation = 'ok' | 'audio_too_long' | 'unsupported_audio'
export type ValidateAudio = (audio: File, signal: AbortSignal) => Promise<AudioValidation>
export type TranscribeAudio = (audio: File, signal: AbortSignal) => Promise<string>

const audioFormats = new Map([
  ['application/ogg', 'ogg'],
  ['audio/ogg', 'ogg'],
  ['audio/webm', 'matroska,webm'],
  ['audio/wav', 'wav'],
  ['audio/wave', 'wav'],
  ['audio/x-wav', 'wav'],
  ['audio/mpeg', 'mp3'],
  ['audio/mp4', 'mov,mp4,m4a,3gp,3g2,mj2'],
  ['audio/x-m4a', 'mov,mp4,m4a,3gp,3g2,mj2'],
  ['audio/aac', 'aac'],
  ['audio/flac', 'flac'],
])

const execFileAsync = promisify(execFile)
const samplesPerSecond = 8000
const bytesPerSample = 2
const maxDecodedBytes = maxInputAudioSeconds * samplesPerSecond * bytesPerSample
const transcriptSchema = z.object({ text: z.string() })
const mediaType = (audio: File) => audio.type.split(';', 1)[0].trim()

export const validateAudio: ValidateAudio = async (audio, signal) => {
  const format = audioFormats.get(mediaType(audio))
  if (!format || !audio.size) return 'unsupported_audio'

  const directory = await mkdtemp(join(tmpdir(), 'financebro-audio-'))
  try {
    const path = join(directory, 'input')
    await writeFile(path, Buffer.from(await audio.arrayBuffer()), { signal })

    try {
      // Decode a bounded prefix. Container durations may be missing or inaccurate.
      const { stdout } = await execFileAsync(
        'ffmpeg',
        [
          '-v',
          'error',
          '-xerror',
          '-nostdin',
          '-protocol_whitelist',
          'file,pipe',
          '-format_whitelist',
          format,
          '-threads',
          '1',
          '-i',
          path,
          '-vn',
          '-sn',
          '-dn',
          '-t',
          String(maxInputAudioSeconds + 0.1),
          '-ac',
          '1',
          '-ar',
          String(samplesPerSecond),
          '-f',
          's16le',
          'pipe:1',
        ],
        { encoding: 'buffer', timeout: 5000, maxBuffer: maxDecodedBytes + 8192, signal },
      )
      if (!stdout.length) return 'unsupported_audio'
      return stdout.length > maxDecodedBytes ? 'audio_too_long' : 'ok'
    } catch (error) {
      if (signal.aborted || (error as NodeJS.ErrnoException).code === 'ENOENT') throw error
      return 'unsupported_audio'
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

export function createAudioTranscriber(whisperUrl: string): TranscribeAudio {
  return async (audio, signal) => {
    const form = new FormData()
    // Use a service-generated filename instead of the client's uploaded name.
    const extension = mediaType(audio).split('/')[1]
    form.set('file', audio, `voice.${extension}`)
    form.set('response_format', 'json')
    const result = await fetch(whisperUrl, {
      method: 'POST',
      body: form,
      signal,
      redirect: 'error',
    })
    if (!result.ok) throw new Error('Voice transcription failed')
    return transcriptSchema.parse(await result.json()).text
  }
}
