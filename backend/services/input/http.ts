import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { z } from 'zod'
import {
  clarificationRequestSchema,
  inputContextSchema,
  inputTextSchema,
  maxInputAudioBytes,
  maxInputTextLength,
  type CategoryMatchingContext,
  type InputContext,
  type ParseError,
  type ParseResult,
  type ParsedOperationRow,
} from '../../packages/contracts/input.ts'
import type { OperationDraft } from '../../packages/contracts/transactions.ts'
import { matchOperationCategories } from '../../packages/shared/categories/matching.ts'
import {
  validateAudio as defaultValidateAudio,
  type TranscribeAudio,
  type ValidateAudio,
} from './audio.ts'
import { dateInZone } from '../../packages/shared/calendar.ts'
import { splitOperationMessage } from './parsing/message-operations.ts'
import { parseClarification, parseOperationInput } from './operation.ts'

type CategoryMatcher = (
  context: CategoryMatchingContext,
  draft: OperationDraft,
) => ReturnType<typeof matchOperationCategories>

type InputServerOptions = {
  tokens: readonly string[]
  transcribe: TranscribeAudio
  validateAudio?: ValidateAudio
  matchCategories?: CategoryMatcher
  transcriptionTimeoutMs?: number
}

type ParseInput = { context: InputContext } & ({ text: string } | { audio: File })
type RequestError = { status: number } & ParseError

const maxContextBytes = 1024 * 1024
const textRequestSchema = z.object({
  text: inputTextSchema,
  context: inputContextSchema,
})

function send(response: ServerResponse, status: number, payload: object) {
  if (response.destroyed) return
  response
    .writeHead(status, {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    })
    .end(JSON.stringify(payload))
}

function tokenDigest(token: string) {
  return createHash('sha256').update(token).digest()
}

async function readBody(request: IncomingMessage, maxBytes: number) {
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    length += chunk.length
    if (length > maxBytes) {
      request.resume()
      return null
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

async function readInput(request: IncomingMessage): Promise<ParseInput | RequestError> {
  const contentType = request.headers['content-type'] ?? ''
  const mediaType = contentType.split(';', 1)[0].trim().toLowerCase()
  const multipart = mediaType === 'multipart/form-data'
  if (!multipart && mediaType !== 'application/json') {
    request.resume()
    return { status: 415, error: 'invalid_request' }
  }

  const maxBytes =
    maxContextBytes + (multipart ? maxInputAudioBytes + 4096 : maxInputTextLength * 4)
  const body = await readBody(request, maxBytes)
  if (!body) return { status: 413, error: multipart ? 'audio_too_large' : 'invalid_request' }

  try {
    if (!multipart) {
      const parsed = textRequestSchema.safeParse(JSON.parse(body.toString('utf8')))
      if (parsed.success) return parsed.data
    } else {
      // Buffering is bounded before multipart parsing starts.
      const form = await new Response(body, { headers: { 'Content-Type': contentType } }).formData()
      const [audio, ...extraFiles] = form.getAll('audio')
      const [context, ...extraContexts] = form.getAll('context')
      if (
        audio instanceof File &&
        context !== undefined &&
        !extraFiles.length &&
        !extraContexts.length
      ) {
        if (audio.size > maxInputAudioBytes) return { status: 413, error: 'audio_too_large' }
        const contextBytes = typeof context === 'string' ? Buffer.byteLength(context) : context.size
        if (contextBytes > maxContextBytes) return { status: 413, error: 'invalid_request' }
        const parsed = inputContextSchema.safeParse(
          JSON.parse(typeof context === 'string' ? context : await context.text()),
        )
        if (parsed.success) return { context: parsed.data, audio }
      }
    }
  } catch (error) {
    if (!(error instanceof SyntaxError) && !(error instanceof TypeError)) throw error
  }
  return { status: 400, error: 'invalid_request' }
}

export function buildOperationResult(
  text: string,
  context: InputContext,
  matchCategories: CategoryMatcher,
  transcript?: string,
): ParseResult | RequestError {
  const parts = splitOperationMessage(text)
  if (!parts) return { status: 422, error: 'unrecognized', transcript }
  // A short dotted number can be a date or a decimal amount.
  // Preserve the established single-operation interpretation when it resolves a date.
  if (parts.length > 1 && /(?<![\d.])\d{1,2}\.\d{1,2}(?![\d.])/u.test(text)) {
    const single = buildOperationRow(text, context, matchCategories, false)
    if (!('error' in single) && (single.draft.operationDate || single.dateConfirmation)) {
      return { ...single, ...(transcript === undefined ? {} : { transcript }) }
    }
  }
  const rows: ParsedOperationRow[] = []
  const batch = parts.length > 1
  let date = batch
    ? { date: dateInZone(context.timeZone, new Date(context.sentAt)), timeZone: context.timeZone }
    : null
  for (const part of parts) {
    const row = buildOperationRow(part.text, context, matchCategories, part.extra)
    if ('error' in row) return { ...row, transcript }
    if (batch) {
      if (!row.draft.description && !part.extra) {
        return { status: 422, error: 'unrecognized', transcript }
      }
      if (row.dateConfirmation) {
        // In a list, the preview confirms a single resolved date. Multiple dates need a new input.
        if (row.dateConfirmation.dates.length !== 1) {
          return { status: 422, error: 'unrecognized', transcript }
        }
        delete row.dateConfirmation
        row.needsClarification = row.needsClarification.filter((field) => field !== 'operationDate')
      }
      date = row.draft.operationDate ?? date
      row.draft.operationDate = date
    }
    rows.push(row)
  }
  return {
    ...rows[0]!,
    ...(batch ? { rows } : {}),
    ...(transcript === undefined ? {} : { transcript }),
  }
}

function buildOperationRow(
  text: string,
  context: InputContext,
  matchCategories: CategoryMatcher,
  extra: boolean,
): ParsedOperationRow | RequestError {
  const parsed = parseOperationInput(text, context, extra)
  if (parsed.status !== 'parsed') {
    return {
      status: 422,
      error: parsed.status,
      ...(parsed.status === 'invalid_date' ? { message: parsed.message } : {}),
    }
  }

  const { draft, dateConfirmation } = parsed
  if (extra && /^(?:₽|руб(?:лей|ля|ль|\.)?|р\.?)$/iu.test(draft.description)) draft.description = ''
  const incomeVerb = /(?<!\p{L})(?:пришл[ои]|поступил[аио]?)(?!\p{L})/iu
  const incoming = incomeVerb.test(text)
  if (incoming)
    draft.description = draft.description.replace(/\s+(?:пришл[ои]|поступил[аио]?)$/iu, '')
  const hintedKind = extra && !draft.description ? 'expense' : incoming ? 'income' : undefined
  const { kind, categoryCandidates } = matchCategories(context, {
    ...draft,
    kind: draft.kind ?? context.kind ?? hintedKind,
  })
  const operationDate =
    draft.operationDate ??
    (dateConfirmation?.dates.length === 1
      ? { date: dateConfirmation.dates[0], timeZone: dateConfirmation.timeZone }
      : null)
  const needsClarification: ParseResult['needsClarification'] = []
  if (dateConfirmation) needsClarification.push('operationDate')
  if (!kind) needsClarification.push('kind')
  if (categoryCandidates.length !== 1 || !kind) needsClarification.push('categoryId')

  return {
    draft: {
      kind: kind ?? null,
      amountKopecks: draft.amountKopecks.toString(),
      currency: 'RUB',
      description: draft.description,
      operationDate,
    },
    categoryCandidates,
    needsClarification,
    ...(dateConfirmation ? { dateConfirmation } : {}),
  }
}

export function createInputServer({
  tokens,
  transcribe,
  validateAudio = defaultValidateAudio,
  matchCategories = matchOperationCategories,
  transcriptionTimeoutMs = 45_000,
}: InputServerOptions) {
  if (tokens.length === 0 || tokens.some((token) => !token || /\s/u.test(token))) {
    throw new Error('Требуется токен сервиса обработки ввода.')
  }
  const digests = tokens.map(tokenDigest)

  return createServer({ requestTimeout: 30_000 }, async (request, response) => {
    const requestId = randomUUID()
    response.setHeader('X-Request-Id', requestId)
    const url = URL.parse(request.url ?? '', 'http://localhost')
    const path = url?.pathname
    if (path === '/health' && request.method === 'GET') {
      request.resume()
      return send(response, 200, { status: 'ok' })
    }
    if (path !== '/v1/parse' && path !== '/v1/parse/answer') {
      request.resume()
      return send(response, 404, { error: 'not_found' })
    }
    if (request.method !== 'POST') {
      request.resume()
      response.setHeader('Allow', 'POST')
      return send(response, 405, { error: 'method_not_allowed' })
    }
    const [auth, ...extraAuth] = request.headersDistinct.authorization ?? []
    const candidate = auth?.startsWith('Bearer ') ? tokenDigest(auth.slice(7)) : null
    if (
      !candidate ||
      extraAuth.length ||
      !digests.some((digest) => timingSafeEqual(digest, candidate))
    ) {
      request.resume()
      return send(response, 401, { error: 'unauthorized' })
    }

    const aborted = new AbortController()
    response.on('close', () => aborted.abort())
    try {
      if (path === '/v1/parse/answer') {
        const mediaType = request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase()
        if (mediaType !== 'application/json') {
          request.resume()
          return send(response, 415, { error: 'invalid_request' })
        }
        const body = await readBody(request, maxInputTextLength * 6 + 4096)
        if (!body) return send(response, 413, { error: 'invalid_request' })
        let json: unknown
        try {
          json = JSON.parse(body.toString('utf8'))
        } catch (error) {
          if (!(error instanceof SyntaxError)) throw error
          return send(response, 400, { error: 'invalid_request' })
        }
        const answer = clarificationRequestSchema.safeParse(json)
        if (!answer.success) return send(response, 400, { error: 'invalid_request' })
        const result = parseClarification(answer.data)
        return send(response, 'error' in result ? 422 : 200, result)
      }
      const input = await readInput(request)
      if ('error' in input) return send(response, input.status, { error: input.error })

      let transcript: string | undefined
      if ('audio' in input) {
        const validation = await validateAudio(input.audio, aborted.signal)
        if (validation === 'unsupported_audio')
          return send(response, 415, { error: 'unsupported_audio' })
        if (validation === 'audio_too_long') return send(response, 413, { error: 'audio_too_long' })

        const timeout = AbortSignal.timeout(transcriptionTimeoutMs)
        const signal = AbortSignal.any([aborted.signal, timeout])
        try {
          transcript = (await transcribe(input.audio, signal)).trim()
        } catch {
          if (aborted.signal.aborted) return
          const error = timeout.aborted ? 'transcription_timeout' : 'transcription_failed'
          console.error('FinanceBro input', requestId, error)
          return send(response, timeout.aborted ? 504 : 502, { error })
        }
        if (!transcript) return send(response, 422, { error: 'empty_transcript' })
      }

      const text = 'text' in input ? input.text : transcript!
      const result = buildOperationResult(text, input.context, matchCategories, transcript)
      if (!('error' in result) && result.rows && url?.searchParams.get('batch') !== 'true') {
        return send(response, 422, { error: 'unrecognized', transcript })
      }
      if ('error' in result) {
        const { status, ...error } = result
        return send(response, status, error)
      }
      return send(response, 200, result)
    } catch {
      if (aborted.signal.aborted) return
      console.error('FinanceBro input', requestId, 'processor_unavailable')
      return send(response, 503, { error: 'processor_unavailable' })
    }
  })
}
