import { createHash, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

const defaultJsonLimit = 16 * 1024

export class HttpRequestError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string) {
    super(code)
    this.status = status
    this.code = code
  }
}

export function isServiceAuthorized(request: IncomingMessage, token: string): boolean {
  const values = request.headersDistinct.authorization
  if (!token || values?.length !== 1) return false
  const match = /^Bearer (\S+)$/i.exec(values[0]!)
  if (!match) return false

  const digest = (value: string) => createHash('sha256').update(value).digest()
  return timingSafeEqual(digest(match[1]!), digest(token))
}

export async function readBody(request: IncomingMessage, maxBytes: number): Promise<Buffer> {
  if (Number(request.headers['content-length']) > maxBytes) {
    throw new HttpRequestError(413, 'body_too_large')
  }

  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request.iterator({ destroyOnReturn: false }) as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > maxBytes) throw new HttpRequestError(413, 'body_too_large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, size)
}

export async function readJson(
  request: IncomingMessage,
  maxBytes = defaultJsonLimit,
): Promise<unknown> {
  const mediaType = request.headers['content-type']?.split(';')[0]?.trim().toLowerCase()
  if (mediaType !== 'application/json') throw new HttpRequestError(415, 'unsupported_media_type')

  const body = await readBody(request, maxBytes)
  try {
    return JSON.parse(body.toString('utf8'))
  } catch {
    throw new HttpRequestError(400, 'invalid_json')
  }
}

export function sendJson(response: ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body)
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(json)
}
