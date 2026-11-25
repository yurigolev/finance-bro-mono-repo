import type { IncomingMessage, ServerResponse } from 'node:http'
import type { TelegramDependencies } from '../../../packages/contracts/telegram-dependencies.ts'
import { HttpRequestError, isServiceAuthorized, readJson, sendJson } from './http.ts'
import {
  telegramContract,
  telegramEndpointPrefix,
  type EndpointArgs,
  type EndpointGroup,
  type EndpointService,
} from '../../../packages/contracts/telegram.ts'

const telegramJsonLimit = 32 * 1024

export function createTelegramCoreHandler(dependencies: TelegramDependencies, token: string) {
  const routes = new Map<string, (body: unknown) => Promise<unknown>>()

  function registerGroup<Group extends EndpointGroup>(
    name: string,
    group: Group,
    service: EndpointService<Group>,
  ) {
    for (const method in group) {
      const { args, result } = group[method]!
      routes.set(`${telegramEndpointPrefix}/${name}/${method}`, async (body) => {
        const parsed = args.safeParse(body)
        if (!parsed.success) throw new HttpRequestError(400, 'invalid_input')
        const values = parsed.data as EndpointArgs<Group[typeof method]>
        const value = await service[method](...values)
        return result.encode(value)
      })
    }
  }

  registerGroup('users', telegramContract.users, dependencies.users)
  registerGroup('categories', telegramContract.categories, dependencies.categories)
  registerGroup('transactions', telegramContract.transactions, dependencies.transactions)
  registerGroup('budgets', telegramContract.budgets, dependencies.budgets)

  return async (request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> => {
    if (!url.pathname.startsWith(`${telegramEndpointPrefix}/`)) return false
    if (!isServiceAuthorized(request, token)) {
      response.setHeader('Connection', 'close')
      sendJson(response, 401, { error: 'invalid_service_authorization' })
      return true
    }
    const route = routes.get(url.pathname)
    if (!route) {
      response.setHeader('Connection', 'close')
      sendJson(response, 404, { error: 'not_found' })
      return true
    }
    if (request.method !== 'POST') {
      response.setHeader('Connection', 'close')
      response.setHeader('Allow', 'POST')
      sendJson(response, 405, { error: 'method_not_allowed' })
      return true
    }
    try {
      sendJson(response, 200, await route(await readJson(request, telegramJsonLimit)))
    } catch (error) {
      if (error instanceof HttpRequestError) {
        response.setHeader('Connection', 'close')
        sendJson(response, error.status, { error: error.code })
      } else {
        console.error('FinanceBro: ошибка внутренней операции Telegram.')
        sendJson(response, 500, { error: 'core_unavailable' })
      }
    }
    return true
  }
}
