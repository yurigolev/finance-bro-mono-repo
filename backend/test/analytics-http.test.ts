import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { once } from 'node:events'
import { test } from 'node:test'
import { createSettingsHandler } from '../services/core/settings/http.ts'
import type { TelegramDependencies } from '../packages/contracts/telegram-dependencies.ts'
import { createAnalyticsServer } from '../services/core/analytics/http.ts'
import { createInitDataVerifier } from '../services/core/analytics/init-data.ts'
import type { AnalyticsPeriod, AnalyticsRange } from '../services/core/analytics/types.ts'

const botToken = '1000000:synthetic-test-token'
const now = new Date('2026-11-21T00:15:00Z')
const issuedAt = Math.floor(now.getTime() / 1000)
const telegramId = 5_000_000_001
const ownerId = '10000000-0000-4000-8000-000000000000'

function launchData(
  authDate = issuedAt,
  user = JSON.stringify({ id: telegramId, first_name: 'Анна & Борис' }),
) {
  const signature = 'example_signature'
  const key = createHmac('sha256', 'WebAppData').update(botToken).digest()
  const hash = createHmac('sha256', key)
    .update(`auth_date=${authDate}\nsignature=${signature}\nuser=${user}`)
    .digest('hex')
  return new URLSearchParams({ user, auth_date: String(authDate), hash, signature }).toString()
}

test('auth verifies all Telegram fields and rejects invalid, stale or ambiguous launches', () => {
  const verify = createInitDataVerifier(botToken, 60)
  const valid = launchData(issuedAt - 60)
  assert.equal(verify(valid, now), telegramId)
  assert.equal(verify(launchData(issuedAt - 61), now), null)
  assert.equal(verify(launchData(issuedAt + 1), now), null)
  assert.equal(verify(launchData(issuedAt, '{invalid JSON'), now), null)
  assert.equal(verify(launchData(issuedAt, '{"id":"5000000001"}'), now), null)
  assert.equal(verify(launchData(issuedAt, '{"id":9007199254740992}'), now), null)
  assert.equal(verify(valid.replace(String(telegramId), '5000000002'), now), null)
  assert.equal(verify(valid.replace('example_signature', 'changed_signature'), now), null)
  assert.equal(verify(`${valid}&auth_date=${issuedAt}`, now), null)
  assert.equal(verify(valid.replace(/hash=[^&]*/, 'hash=not-a-hash'), now), null)
  assert.equal(verify('', now), null)
  assert.equal(createInitDataVerifier('1000001:another-token', 60)(valid, now), null)
})

test('analytics route authenticates the owner, validates the period and keeps secrets out of logs', async (t) => {
  const lookups: number[] = []
  const calls: { owner: string | null; period: AnalyticsPeriod; instant: Date }[] = []
  const ranges: AnalyticsRange[] = []
  const logger = t.mock.method(console, 'error', () => {})
  let failure: 'resolve' | 'overview' | 'invalid-result' | undefined
  const server = createAnalyticsServer({
    botToken,
    now: () => now,
    resolveUserId: async (id) => {
      lookups.push(id)
      if (failure === 'resolve') throw new Error(`database details with ${launchData()}`)
      return id === telegramId ? ownerId : null
    },
    loadOverview: async (owner, period, instant, range) => {
      calls.push({ owner, period, instant })
      if (range) ranges.push(range)
      if (failure === 'overview') throw new Error(`database details with ${launchData()}`)
      return {
        period,
        startDate: range?.startDate ?? '2026-11-01',
        endDate: range?.endDate ?? '2026-11-21',
        timeZone: 'UTC',
        usesUtcFallback: true,
        currency: 'RUB',
        operationCount: 0,
        totals: {
          incomeKopecks: failure === 'invalid-result' ? launchData() : '0',
          expenseKopecks: '0',
          differenceKopecks: '0',
        },
        budget: { month: '2026-11-01', spentKopecks: '0', limitKopecks: null, categories: [] },
        days: [],
        expenseCategories: [],
        expenseCategoriesByDay: {},
        incomeCategories: [],
        incomeCategoriesByDay: {},
      }
    },
  })
  server.listen(0, '127.0.0.1')
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())))
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}/api/analytics/overview`

  async function request(query: string, initData: string | undefined, status: number) {
    const response = await fetch(`${base}${query}`, {
      headers: initData === undefined ? {} : { 'X-Telegram-Init-Data': initData },
    })
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(response.status, status)
    return response.json()
  }

  await request('?period=current-month', undefined, 401)
  await request('?period=current-month', launchData(issuedAt - 3601), 401)
  await request(
    '?period=current-month',
    launchData().replace(String(telegramId), '5000000002'),
    401,
  )
  for (const query of [
    '',
    '?period=all-time',
    '?period=current-month&period=last-7-days',
    '?period=custom',
    '?period=custom&startDate=2026-02-29&endDate=2026-03-01',
    '?period=custom&startDate=2026-11-21&endDate=2026-11-20',
    '?period=custom&startDate=2025-01-01&endDate=2026-01-02',
    '?period=custom&startDate=2026-11-20&startDate=2026-11-19&endDate=2026-11-21',
  ]) {
    assert.deepEqual(await request(query, launchData(), 400), { error: 'invalid_period' })
  }
  assert.deepEqual(calls, [])
  assert.deepEqual(lookups, [])
  const periods = ['current-month', 'current-week', 'last-7-days', 'previous-month'] as const
  for (const period of periods) {
    const result = await request(`?period=${period}&userId=5000000002`, launchData(), 200)
    assert.equal(result.period, period)
  }
  assert.deepEqual(
    lookups,
    periods.map(() => telegramId),
  )
  assert.deepEqual(
    calls,
    periods.map((period) => ({ owner: ownerId, period, instant: now })),
  )

  const unknownId = telegramId + 1
  const unknown = await request(
    '?period=current-month',
    launchData(issuedAt, JSON.stringify({ id: unknownId })),
    200,
  )
  assert.equal(unknown.operationCount, 0)
  assert.equal(lookups.at(-1), unknownId)
  assert.deepEqual(calls.at(-1), { owner: null, period: 'current-month', instant: now })
  assert.equal(logger.mock.callCount(), 0)

  const range = { startDate: '2026-10-30', endDate: '2026-11-02' }
  const custom = await request(`?period=custom&${new URLSearchParams(range)}`, launchData(), 200)
  assert.equal(custom.period, 'custom')
  assert.equal(custom.startDate, range.startDate)
  assert.equal(custom.endDate, range.endDate)
  assert.deepEqual(ranges, [range])
  assert.deepEqual(calls.at(-1), { owner: ownerId, period: 'custom', instant: now })

  failure = 'resolve'
  assert.deepEqual(await request('?period=current-month', launchData(), 500), {
    error: 'analytics_unavailable',
  })
  assert.equal(calls.length, periods.length + 2)
  for (const kind of ['overview', 'invalid-result'] as const) {
    failure = kind
    assert.deepEqual(await request('?period=current-month', launchData(), 500), {
      error: 'analytics_unavailable',
    })
  }
  assert.deepEqual(
    logger.mock.calls.map(({ arguments: args }) => args),
    Array.from({ length: 3 }, () => ['Не удалось загрузить аналитику.']),
  )
})

test('settings authenticate the owner and route validated changes to the bot services', async (t) => {
  const categoryId = '20000000-0000-4000-8000-000000000000'
  const ruleId = '30000000-0000-4000-8000-000000000000'
  const expectedCalls: unknown[][] = []
  const dependencies: Pick<TelegramDependencies, 'users' | 'categories'> = {
    users: {
      getOrCreateUser: async (id) => {
        assert.equal(id, telegramId)
        return ownerId
      },
      getTimeZone: async () => 'Asia/Yekaterinburg',
      setTimeZone: async (...args) => {
        expectedCalls.push(args)
        return { timeZone: args[1] }
      },
    },
    categories: {
      listCategories: async () => [],
      listBuiltInTargets: async () => [],
      listCategoryRules: async () => [],
      getBuiltInRule: async () => null,
      setCategory: async () => false,
      canRememberCategory: async () => false,
      rememberCategory: async () => false,
      addCategory: async (...args) => {
        expectedCalls.push(args)
        return 'ok'
      },
      renameCategory: async (...args) => {
        expectedCalls.push(args)
        return 'duplicate'
      },
      archiveCategory: async (...args) => {
        expectedCalls.push(args)
        return false
      },
      deleteCategoryRule: async (...args) => {
        expectedCalls.push(args)
        return true
      },
      changeBuiltInRule: async (...args) => {
        expectedCalls.push(args)
        return true
      },
      bindBuiltInGroup: async (...args) => {
        expectedCalls.push(args)
        return true
      },
    },
  }
  const server = createAnalyticsServer({
    botToken,
    now: () => now,
    resolveUserId: async () => {
      throw new Error('Unexpected analytics request')
    },
    loadOverview: async () => {
      throw new Error('Unexpected analytics request')
    },
    handleSettings: createSettingsHandler(dependencies),
  })
  server.listen(0, '127.0.0.1')
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())))
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const url = `http://127.0.0.1:${address.port}/api/settings?userId=ignored`
  const headers = { 'X-Telegram-Init-Data': launchData(), 'Content-Type': 'application/json' }
  const get = await fetch(url, { headers })
  assert.equal(get.status, 200)
  assert.equal(get.headers.get('cache-control'), 'no-store')
  const data = await get.json()
  assert.equal(data.timeZone, 'Asia/Yekaterinburg')
  assert.ok(data.groups.some((group: { words: string[] }) => group.words.includes('кофе')))

  const reset = { action: 'time-zone', timeZone: null, userId: 'ignored' }
  const unauthenticated = await fetch(url, { method: 'PATCH', body: JSON.stringify(reset) })
  assert.equal(unauthenticated.status, 401)
  const malformed = await fetch(url, { method: 'PATCH', headers, body: '{' })
  assert.equal(malformed.status, 400)
  const oversized = await fetch(url, { method: 'PATCH', headers, body: 'x'.repeat(4097) })
  assert.equal(oversized.status, 413)
  assert.deepEqual(expectedCalls, [])

  const changes = [
    [reset, 204],
    [{ action: 'add-category', kind: 'expense', name: 'Тест' }, 204],
    [{ action: 'rename-category', id: categoryId, name: 'Другое' }, 409],
    [{ action: 'archive-category', id: categoryId }, 409],
    [{ action: 'delete-rule', id: ruleId, categoryId: null }, 204],
    [{ action: 'change-word', kind: 'expense', word: 'кофе', target: 'reset' }, 204],
    [{ action: 'bind-group', kind: 'expense', key: 'cafes', categoryId }, 204],
  ] as const
  for (const [change, status] of changes) {
    const result = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify(change) })
    assert.equal(result.status, status)
    assert.equal(result.headers.get('cache-control'), 'no-store')
    await result.text()
  }
  assert.deepEqual(expectedCalls, [
    [ownerId, null],
    [ownerId, 'expense', 'Тест'],
    [ownerId, categoryId, 'Другое'],
    [ownerId, categoryId],
    [ownerId, ruleId, null],
    [ownerId, 'expense', 'кофе', 'reset'],
    [ownerId, 'expense', 'cafes', categoryId],
  ])
})
