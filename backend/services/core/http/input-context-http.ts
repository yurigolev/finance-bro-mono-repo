import type { IncomingMessage, ServerResponse } from 'node:http'
import type { createLoadInputContext } from '../categories/service.ts'
import { sendJson } from './http.ts'

const inputContextPath = /^\/internal\/v1\/users\/([^/]+)\/input-context$/u
const telegramId = /^[1-9]\d*$/u

type InputContextDependencies = {
  getOrCreateUser: (telegramId: number) => Promise<string>
  loadInputContext: ReturnType<typeof createLoadInputContext>
}

export function createInputContextHandler({
  getOrCreateUser,
  loadInputContext,
}: InputContextDependencies) {
  return async function handleInputContext(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): Promise<boolean> {
    const match = inputContextPath.exec(url.pathname)
    if (!match) return false
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET')
      sendJson(response, 405, { error: 'method_not_allowed' })
      return true
    }

    const id = Number(match[1])
    if (!telegramId.test(match[1]!) || !Number.isSafeInteger(id)) {
      sendJson(response, 400, { error: 'invalid_telegram_user' })
      return true
    }

    const ownerId = await getOrCreateUser(id)
    sendJson(response, 200, await loadInputContext(ownerId))
    return true
  }
}
