import type { IncomingMessage, ServerResponse } from 'node:http'
import { createAnalyticsServer } from '../analytics/http.ts'
import { createApplication } from '../app.ts'
import { createLoadInputContext } from '../categories/service.ts'
import type { Database } from '../db/client.ts'
import { createSettingsHandler } from '../settings/http.ts'
import { createTransactionsHandler } from '../transactions/http.ts'
import { isServiceAuthorized, sendJson } from './http.ts'
import { createInputContextHandler } from './input-context-http.ts'
import { createStructuredOperationsHandler } from './operations-http.ts'
import { telegramEndpointPrefix } from '../../../packages/contracts/telegram.ts'
import { createTelegramCoreHandler } from './telegram-http.ts'

export type CoreRequestHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
) => Promise<boolean>

export function createCoreServer(
  db: Database,
  options: {
    botToken: string
    maxAgeSeconds: number
    handleInternal?: CoreRequestHandler
  },
  app = createApplication(db),
) {
  return createAnalyticsServer({
    ...options,
    ...app.analytics,
    handleSettings: createSettingsHandler(app.telegram),
    handleTransactions: createTransactionsHandler(db, app.telegram.users),
  })
}

export function createInternalHandler(
  db: Database,
  app: ReturnType<typeof createApplication>,
  token: string,
): CoreRequestHandler {
  const telegram = createTelegramCoreHandler(app.telegram, token)
  const commands = createStructuredOperationsHandler(db, app.telegram.users)
  const inputContext = createInputContextHandler({
    getOrCreateUser: app.telegram.users.getOrCreateUser,
    loadInputContext: createLoadInputContext(db),
  })
  return async (request, response, url) => {
    if (url.pathname.startsWith(`${telegramEndpointPrefix}/`)) {
      return telegram(request, response, url)
    }
    if (!isServiceAuthorized(request, token)) {
      response.setHeader('Connection', 'close')
      sendJson(response, 401, { error: 'invalid_service_authorization' })
      return true
    }
    return (await inputContext(request, response, url)) || commands(request, response, url)
  }
}
