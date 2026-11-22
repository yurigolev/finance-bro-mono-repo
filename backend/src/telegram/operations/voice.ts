import type { Api } from 'grammy'
import { z } from 'zod'

export const maxVoiceSeconds = 20
export const maxVoiceBytes = 1024 * 1024

const voiceFileSchema = z.object({
  file_path: z.string().min(1),
  file_size: z.int().nonnegative().max(maxVoiceBytes).optional(),
})
const transcriptionSchema = z.object({ text: z.string() })

export type TranscribeVoice = (api: Api, fileId: string) => Promise<string>

export function createVoiceTranscriber(whisperUrl: string): TranscribeVoice {
  return async (api, fileId) => {
    const signal = AbortSignal.timeout(45_000)
    // grammY's Node types use the polyfill, but its client accepts a native signal.
    const apiSignal = signal as unknown as Parameters<Api['getFile']>[1]
    const file = voiceFileSchema.safeParse(await api.getFile(fileId, apiSignal))
    if (!file.success) throw new Error('Invalid voice file')

    const apiRoot = api.options?.apiRoot ?? 'https://api.telegram.org'
    const testPath = api.options?.environment === 'test' ? '/test' : ''
    const url = new URL(`${apiRoot}/file/bot${api.token}${testPath}/${file.data.file_path}`)
    const response = await fetch(url, { signal, redirect: 'error' })
    if (!response.ok || !response.body) throw new Error('Voice download failed')

    const audio = new Uint8Array(maxVoiceBytes)
    let size = 0
    for await (const chunk of response.body) {
      if (size + chunk.byteLength > audio.byteLength)
        throw new Error('Voice file exceeds size limit')
      audio.set(chunk, size)
      size += chunk.byteLength
    }
    if (size === 0) throw new Error('Empty voice file')

    const form = new FormData()
    form.set('file', new Blob([audio.subarray(0, size)], { type: 'audio/ogg' }), 'voice.ogg')
    form.set('response_format', 'json')
    const result = await fetch(whisperUrl, {
      method: 'POST',
      body: form,
      signal,
      redirect: 'error',
    })
    if (!result.ok) throw new Error('Voice transcription failed')
    const body = transcriptionSchema.safeParse(await result.json())
    if (!body.success) throw new Error('Invalid transcription response')
    return body.data.text
  }
}
