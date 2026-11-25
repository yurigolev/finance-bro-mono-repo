import assert from 'node:assert/strict'
import { randomInt } from 'node:crypto'
import { once } from 'node:events'
import { test } from 'node:test'
import { createApplication } from '../services/core/app.ts'
import { isServiceAuthorized, sendJson } from '../services/core/http/http.ts'
import { createStructuredOperationsHandler } from '../services/core/http/operations-http.ts'
import { createCoreServer } from '../services/core/http/server.ts'
import { createDatabase } from '../services/core/db/client.ts'
import { createTelegramOperationInput } from '../services/bot/clients/operation-input.ts'
import type { OperationInput } from '../packages/contracts/transactions.ts'

test('Telegram recovers its operation after a lost POST response and treats a later update as duplicate', async (t) => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must point to a migrated test database')
  const { db, pool } = createDatabase(process.env.DATABASE_URL)
  t.after(() => pool.end())
  const app = createApplication(db)
  const { users, transactions, categories } = app.telegram
  const coreToken = 'test-financial-service-token'
  const handleCommands = createStructuredOperationsHandler(
    db,
    users,
    () => new Date('2026-11-24T12:00:00Z'),
  )
  const server = createCoreServer(
    db,
    {
      botToken: 'test-telegram-token',
      maxAgeSeconds: 300,
      handleInternal(request, response, url) {
        if (isServiceAuthorized(request, coreToken)) return handleCommands(request, response, url)
        sendJson(response, 401, { error: 'invalid_service_authorization' })
        return Promise.resolve(true)
      },
    },
    app,
  )
  server.listen(0, '127.0.0.1')
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())))
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')

  const fetchCore = globalThis.fetch
  const posts: Array<{ body: RequestInit['body']; status: number }> = []
  t.mock.method(globalThis, 'fetch', async (...args: Parameters<typeof fetch>) => {
    const response = await fetchCore(...args)
    const [, options] = args
    if (options?.method === 'POST') {
      posts.push({ body: options.body, status: response.status })
      if (posts.length === 1) {
        // Core has committed and produced the response. Simulate losing it in transit.
        assert.equal(response.status, 201)
        await response.arrayBuffer()
        throw new DOMException('Reply lost after commit', 'TimeoutError')
      }
    }
    return response
  })

  const input = createTelegramOperationInput({
    coreUrl: `http://127.0.0.1:${address.port}`,
    coreToken,
    inputUrl: 'http://127.0.0.1:1',
    inputToken: 'test-processor-token',
  })
  const telegramId = randomInt(2 ** 40, 2 ** 41)
  const userId = await users.getOrCreateUser(telegramId)
  const timeZone = 'Asia/Yekaterinburg'
  assert.deepEqual(await users.setTimeZone(userId, timeZone), { timeZone })
  const [previousChoice, category] = await categories.listCategories(userId, 'expense')
  assert.ok(previousChoice && category)
  const key = `telegram:voice:${telegramId}:42`
  const operation: OperationInput = {
    kind: 'expense',
    amountKopecks: 40_000n,
    description: 'кофе в путешествии',
    operationDate: { date: '2026-11-17', timeZone },
  }

  assert.equal(await input.hasOperation(telegramId, key), false)
  const recovered = await input.recordOperation(telegramId, operation, null, key)
  assert.equal(recovered.status, 'created')
  assert.equal(recovered.categoryName, null)
  assert.equal(await input.hasOperation(telegramId, key), true)

  assert.equal(await categories.archiveCategory(userId, previousChoice.id), true)
  assert.equal(
    await input.setCategory(telegramId, recovered.id, previousChoice.id),
    'category-unavailable',
  )
  assert.equal(await input.setCategory(telegramId, recovered.id, category.id), 'updated')
  assert.deepEqual(await input.recordOperation(telegramId, operation, null, key), {
    status: 'duplicate',
  })

  const history = await transactions.dailyHistory(userId, operation.operationDate!.date, timeZone)
  assert.equal(history.length, 1)
  assert.equal(history[0]?.id, recovered.id)
  assert.equal(history[0]?.amountKopecks, operation.amountKopecks)
  assert.equal(history[0]?.categoryName, category.name)
  assert.deepEqual(
    posts.map(({ status }) => status),
    [201, 200, 200],
  )
  assert.equal(new Set(posts.map(({ body }) => body)).size, 1)
})
