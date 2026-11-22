import { createServer, type ServerResponse } from 'node:http'
import { z } from 'zod'
import {
  createInitDataVerifier,
  defaultInitDataMaxAgeSeconds,
  initDataMaxAgeSchema,
} from './init-data.ts'
import {
  analyticsOverviewSchema,
  analyticsPeriodSchema,
  analyticsRangeSchema,
  type LoadAnalyticsOverview,
} from './types.ts'

const initDataHeaderSchema = z.tuple([z.string()])
const periodQuerySchema = z.tuple([analyticsPeriodSchema])
const dateQuerySchema = z.tuple([z.iso.date()])

type AnalyticsServerOptions = {
  botToken: string
  resolveUserId: (telegramId: number) => Promise<string | null>
  loadOverview: LoadAnalyticsOverview
  maxAgeSeconds?: number
  now?: () => Date
}

function sendJson(response: ServerResponse, status: number, body: object) {
  const json = JSON.stringify(body)
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(json)
}

export function createAnalyticsServer({
  botToken,
  resolveUserId,
  loadOverview,
  maxAgeSeconds = defaultInitDataMaxAgeSeconds,
  now = () => new Date(),
}: AnalyticsServerOptions) {
  if (!initDataMaxAgeSchema.safeParse(maxAgeSeconds).success) {
    throw new RangeError('Некорректный срок действия данных запуска Telegram.')
  }
  const verifyInitData = createInitDataVerifier(botToken, maxAgeSeconds)

  return createServer(async (request, response) => {
    const url = URL.parse(request.url ?? '', 'http://localhost')
    if (url?.pathname !== '/api/analytics/overview') {
      sendJson(response, 404, { error: 'not_found' })
      return
    }
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET')
      sendJson(response, 405, { error: 'method_not_allowed' })
      return
    }

    const initData = initDataHeaderSchema.safeParse(request.headersDistinct['x-telegram-init-data'])
    const instant = now()
    const telegramId = initData.success ? verifyInitData(initData.data[0], instant) : null
    if (telegramId === null) {
      sendJson(response, 401, { error: 'invalid_telegram_init_data' })
      return
    }
    const period = periodQuerySchema.safeParse(url.searchParams.getAll('period'))
    if (!period.success) {
      sendJson(response, 400, { error: 'invalid_period' })
      return
    }

    const [selectedPeriod] = period.data
    let range
    if (selectedPeriod === 'custom') {
      const start = dateQuerySchema.safeParse(url.searchParams.getAll('startDate'))
      const end = dateQuerySchema.safeParse(url.searchParams.getAll('endDate'))
      const parsedRange = analyticsRangeSchema.safeParse({
        startDate: start.data?.[0],
        endDate: end.data?.[0],
      })
      if (!parsedRange.success) {
        sendJson(response, 400, { error: 'invalid_period' })
        return
      }
      range = parsedRange.data
    }

    try {
      const userId = await resolveUserId(telegramId)
      const overview = await loadOverview(userId, selectedPeriod, instant, range)
      sendJson(response, 200, analyticsOverviewSchema.parse(overview))
    } catch {
      console.error('Не удалось загрузить аналитику.')
      sendJson(response, 500, { error: 'analytics_unavailable' })
    }
  })
}
