import assert from 'node:assert/strict'
import { randomInt } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { test, type TestContext } from 'node:test'
import { createApplication } from '../services/core/app.ts'
import { createTelegramCoreHandler } from '../services/core/http/telegram-http.ts'
import { createDatabase } from '../services/core/db/client.ts'
import { createTelegramCoreClient } from '../services/bot/clients/core.ts'
import type { TelegramDependencies } from '../packages/contracts/telegram-dependencies.ts'

const token = 'only-a-local-test-token'
const ownerId = '10000000-0000-4000-8000-000000000000'
const operationId = '20000000-0000-4000-8000-000000000000'
const categoryId = '30000000-0000-4000-8000-000000000000'
const createdAt = new Date('2026-11-17T07:00:00Z')
const operationDate = { date: '2026-11-17', timeZone: 'Asia/Yekaterinburg' }
const amountKopecks = 9_223_372_036_854_775_807n

function stubDependencies(overrides: {
  [Group in keyof TelegramDependencies]?: Partial<TelegramDependencies[Group]>
}): TelegramDependencies {
  // Only methods reached by the test need implementations.
  return overrides as unknown as TelegramDependencies
}

async function serve(t: TestContext, dependencies: TelegramDependencies) {
  const handle = createTelegramCoreHandler(dependencies, token)
  const server = createServer(async (request, response) => {
    if (!(await handle(request, response, new URL(request.url ?? '', 'http://localhost')))) {
      response.writeHead(404).end()
    }
  })
  server.listen(0, '127.0.0.1')
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())))
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const baseUrl = `http://127.0.0.1:${address.port}`
  return { baseUrl, client: createTelegramCoreClient({ baseUrl, token }) }
}

test('Telegram HTTP adapter preserves optional arguments, dates and exact amounts', async (t) => {
  const category = { id: categoryId, name: 'Кафе' }
  const operation = {
    id: operationId,
    kind: 'expense',
    amountKopecks,
    createdAt,
    description: 'кофе',
    categoryName: null,
  } as const
  const selectedBudget = {
    budget: {
      totalLimit: null,
      totalSpent: amountKopecks * 2n,
      categories: [{ ...category, archived: true, limit: amountKopecks, spent: 40_000n }],
    },
    selected: '2026-11-01',
    current: '2026-11-01',
  }
  const dependencies = stubDependencies({
    users: {
      getOrCreateUser: async (telegramId) => {
        assert.equal(telegramId, 123)
        return ownerId
      },
      getTimeZone: async (owner) => {
        assert.equal(owner, ownerId)
        return null
      },
    },
    transactions: {
      loadDailyHistory: async (owner, date) => {
        assert.equal(owner, ownerId)
        if (date === null) return null
        return { ...operationDate, today: '2026-11-24', operations: [operation] }
      },
      getOperation: async (owner, id) => {
        assert.equal(owner, ownerId)
        assert.equal(id, operationId)
        return { ...operation, idempotencyKey: 'telegram:2', operationDate }
      },
    },
    categories: {
      listCategoryRules: async () => [
        {
          id: categoryId,
          categoryId,
          expression: 'кофе',
          kind: 'expense',
          categoryName: category.name,
          archivedAt: createdAt,
        },
      ],
    },
    budgets: {
      viewBudget: async (owner, month) => {
        assert.equal(owner, ownerId)
        assert.equal(month, undefined)
        return selectedBudget
      },
      changeBudgetLimit: async (owner, month, category, change, now) => {
        assert.equal(owner, ownerId)
        assert.equal(month, '2026-11-01')
        assert.equal(category, null)
        assert.deepEqual(change, { kind: 'set', amountKopecks })
        assert.deepEqual(now, createdAt)
        return 'saved'
      },
    },
  })
  const { client } = await serve(t, dependencies)
  assert.equal(await client.users.getOrCreateUser(123), ownerId)
  assert.equal(await client.users.getTimeZone(ownerId), null)
  assert.equal(await client.transactions.loadDailyHistory(ownerId, null), null)
  for (const result of [
    await client.transactions.loadDailyHistory(ownerId),
    await client.transactions.loadDailyHistory(ownerId, undefined),
  ]) {
    assert.deepEqual(result, { ...operationDate, today: '2026-11-24', operations: [operation] })
  }
  assert.deepEqual(await client.transactions.getOperation(ownerId, operationId), {
    ...operation,
    idempotencyKey: 'telegram:2',
    operationDate,
  })
  const [rule] = await client.categories.listCategoryRules(ownerId)
  assert.deepEqual(rule?.archivedAt, createdAt)
  assert.deepEqual(await client.budgets.viewBudget(ownerId), selectedBudget)
  assert.equal(
    await client.budgets.changeBudgetLimit(
      ownerId,
      '2026-11-01',
      null,
      { kind: 'set', amountKopecks },
      createdAt,
    ),
    'saved',
  )
})

test('Telegram endpoints require authorization, validate requests and reject legacy writes', async (t) => {
  let calls = 0
  const dependencies = stubDependencies({
    transactions: {
      setOperationDate: async (owner, operation, date) => {
        calls++
        assert.deepEqual([owner, operation, date], [ownerId, operationId, operationDate])
        return true
      },
    },
  })
  const { baseUrl } = await serve(t, dependencies)
  const url = `${baseUrl}/internal/v1/telegram/transactions/setOperationDate`
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const valid = JSON.stringify([ownerId, operationId, operationDate])

  const requests: [string, RequestInit, number, string][] = [
    [url, { method: 'POST', body: valid }, 401, 'invalid_service_authorization'],
    [url, { headers }, 405, 'method_not_allowed'],
    [url, { method: 'POST', headers, body: '[' }, 400, 'invalid_json'],
    [
      url,
      { method: 'POST', headers, body: valid.replace(operationDate.date, '2026-02-29') },
      400,
      'invalid_input',
    ],
    [url, { method: 'POST', headers, body: ' '.repeat(33 * 1024) }, 413, 'body_too_large'],
    [
      url,
      { method: 'POST', headers: { Authorization: headers.Authorization }, body: valid },
      415,
      'unsupported_media_type',
    ],
    [
      `${baseUrl}/internal/v1/telegram/transactions/recordOperation`,
      { method: 'POST', headers, body: valid },
      404,
      'not_found',
    ],
  ]
  for (const [target, options, status, error] of requests) {
    const response = await fetch(target, options)
    assert.equal(response.status, status)
    assert.deepEqual(await response.json(), { error })
    assert.equal(response.headers.get('cache-control'), 'no-store')
  }
  assert.equal(calls, 0)
  const response = await fetch(url, { method: 'POST', headers, body: valid })
  assert.equal(response.status, 200)
  assert.equal(await response.json(), true)
  assert.equal(calls, 1)
})

const testDatabaseUrl = process.env.TEST_TELEGRAM_CORE_DATABASE_URL ?? process.env.DATABASE_URL
test(
  'Telegram reads and edits preserve existing accounting state',
  { skip: !testDatabaseUrl },
  async (t) => {
    const { db, pool } = createDatabase(testDatabaseUrl!)
    t.after(() => pool.end())
    const application = createApplication(db)
    const { client } = await serve(t, application.telegram)
    const owner = await client.users.getOrCreateUser(randomInt(2 ** 45, 2 ** 46))
    assert.deepEqual(await client.users.setTimeZone(owner, operationDate.timeZone), {
      timeZone: operationDate.timeZone,
    })
    const draft = { amountKopecks: 40_000n, operationDate, description: 'некатегоризуемое' }
    const confirmed = { ...draft, kind: 'expense' } as const
    const created = await application.telegram.transactions.recordOperation(
      owner,
      confirmed,
      'telegram:1',
    )
    assert.equal(created.status, 'created')
    const stored = await client.transactions.getOperation(owner, created.id)
    assert.equal(stored?.amountKopecks, draft.amountKopecks)
    assert.ok(stored?.createdAt instanceof Date)
    assert.deepEqual(stored.operationDate, operationDate)
    const [category] = await client.categories.listCategories(owner, 'expense')
    assert.ok(category)
    assert.equal(await client.categories.setCategory(owner, created.id, category.id), true)
    assert.equal(
      (await client.transactions.getOperation(owner, created.id))?.categoryName,
      category.name,
    )
    const daily = await client.transactions.dailyHistory(
      owner,
      operationDate.date,
      operationDate.timeZone,
    )
    assert.deepEqual(
      daily.map(({ id }) => id),
      [created.id],
    )
    const budget = await client.budgets.monthlyBudget(owner, '2026-11-01', operationDate.timeZone)
    assert.equal(budget.totalSpent, draft.amountKopecks)
    assert.equal(await client.transactions.remove(owner, created.id), true)
    assert.equal(await client.transactions.getOperation(owner, created.id), null)
  },
)
