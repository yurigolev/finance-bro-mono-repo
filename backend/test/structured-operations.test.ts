import assert from 'node:assert/strict'
import { randomInt, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { test, type TestContext } from 'node:test'
import { createApplication } from '../services/core/app.ts'
import {
  structuredOperationResultSchema,
  type StructuredOperationRequest,
} from '../packages/contracts/operations.ts'
import { createStructuredOperationsHandler } from '../services/core/http/operations-http.ts'
import { createDatabase } from '../services/core/db/client.ts'

const operationsPath = '/internal/v1/operations'
const timeZone = 'Asia/Yekaterinburg'

async function start(t: TestContext) {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must point to a migrated test database')
  const { db, pool } = createDatabase(process.env.DATABASE_URL)
  const app = createApplication(db).telegram
  const handle = createStructuredOperationsHandler(
    db,
    app.users,
    () => new Date('2026-11-24T12:00:00Z'),
  )
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    void handle(request, response, url).then((handled) => {
      if (!handled) response.writeHead(404).end()
    })
  })
  server.listen(0, '127.0.0.1')
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await pool.end()
  })
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const origin = `http://127.0.0.1:${address.port}`

  async function command(path: string, method: 'POST' | 'PATCH', body: unknown) {
    return fetch(origin + path, {
      method,
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return {
    app,
    pool,
    post: (body: unknown) => command(operationsPath, 'POST', body),
    postBatch: (body: unknown) => command(`${operationsPath}/batch`, 'POST', body),
    patch: (id: string, telegramUserId: number, categoryId: string | null) =>
      command(`${operationsPath}/${id}`, 'PATCH', { telegramUserId, categoryId }),
    readReplay: (telegramId: number, idempotencyKey: string) => {
      const query = new URLSearchParams({ telegramUserId: String(telegramId), idempotencyKey })
      return fetch(`${origin}${operationsPath}/replay?${query}`)
    },
  }
}

function request(telegramUserId = randomInt(2 ** 40, 2 ** 41)): StructuredOperationRequest {
  return {
    telegramUserId,
    idempotencyKey: `telegram:voice:${telegramUserId}:${randomInt(1, 2 ** 31)}`,
    kind: 'expense',
    amountKopecks: '40000',
    currency: 'RUB',
    description: 'кофе в путешествии',
    operationDate: { date: '2026-11-17', timeZone },
    categoryId: null,
  }
}

async function expectError(response: Response, status: number, error: string) {
  assert.equal(response.status, status)
  assert.deepEqual(await response.json(), { error })
}

test('structured writes preserve money and date and reject unavailable categories', async (t) => {
  const { app, post, patch } = await start(t)
  const body = request()
  const owner = await app.users.getOrCreateUser(body.telegramUserId)
  const foreignTelegramId = randomInt(2 ** 40, 2 ** 41)
  const foreign = await app.users.getOrCreateUser(foreignTelegramId)
  assert.deepEqual(await app.users.setTimeZone(owner, timeZone), { timeZone })
  const [category, archived] = await app.categories.listCategories(owner, 'expense')
  const [income] = await app.categories.listCategories(owner, 'income')
  const [foreignCategory] = await app.categories.listCategories(foreign, 'expense')
  assert.ok(category && archived && income && foreignCategory)
  assert.equal(await app.categories.archiveCategory(owner, archived.id), true)

  const response = await post(body)
  assert.equal(response.status, 201)
  const saved = structuredOperationResultSchema.parse(await response.json())
  assert.deepEqual(saved, {
    id: saved.id,
    kind: 'expense',
    categoryId: null,
    categoryName: null,
    replayed: false,
    deleted: false,
  })
  const operation = await app.transactions.getOperation(owner, saved.id)
  assert.equal(operation?.amountKopecks, 40_000n)
  assert.deepEqual(operation?.operationDate, body.operationDate)

  await expectError(
    await patch(saved.id, foreignTelegramId, category.id),
    404,
    'operation_unavailable',
  )
  for (const unavailable of [archived.id, income.id, foreignCategory.id]) {
    await expectError(
      await patch(saved.id, body.telegramUserId, unavailable),
      409,
      'category_unavailable',
    )
    await expectError(
      await post({ ...body, idempotencyKey: `telegram:${randomUUID()}`, categoryId: unavailable }),
      409,
      'category_unavailable',
    )
  }
  assert.equal((await app.transactions.recent(owner)).length, 1)
  assert.equal((await app.transactions.getOperation(owner, saved.id))?.categoryName, null)

  const assigned = await patch(saved.id, body.telegramUserId, category.id)
  assert.equal(assigned.status, 200)
  assert.deepEqual(await assigned.json(), {
    id: saved.id,
    kind: 'expense',
    categoryId: category.id,
  })
  assert.equal((await app.transactions.getOperation(owner, saved.id))?.categoryName, category.name)

  const cleared = await patch(saved.id, body.telegramUserId, null)
  assert.equal(cleared.status, 200)
  assert.deepEqual(await cleared.json(), { id: saved.id, kind: 'expense', categoryId: null })
  assert.equal((await app.transactions.getOperation(owner, saved.id))?.categoryName, null)

  const explicit = await post({
    ...body,
    idempotencyKey: `telegram:${randomUUID()}`,
    categoryId: category.id,
    amountKopecks: '9223372036854775807',
    description: '',
    operationDate: undefined,
  })
  assert.equal(explicit.status, 201)
  const withCategory = structuredOperationResultSchema.parse(await explicit.json())
  assert.equal(withCategory.categoryName, category.name)
  assert.equal(
    (await app.transactions.getOperation(owner, withCategory.id))?.amountKopecks,
    9_223_372_036_854_775_807n,
  )
})

test('concurrent retries return one operation, including replays of deleted and legacy operations', async (t) => {
  const { app, pool, post, patch, readReplay } = await start(t)
  const body = request()
  const owner = await app.users.getOrCreateUser(body.telegramUserId)
  const other = request().telegramUserId
  const initial = await readReplay(body.telegramUserId, body.idempotencyKey)
  assert.equal(initial.status, 200)
  assert.equal(await initial.json(), null)

  const responses = await Promise.all([post(body), post(body), post(body)])
  assert.deepEqual(responses.map(({ status }) => status).sort(), [200, 200, 201])
  const results = await Promise.all(
    responses.map(async (response) => structuredOperationResultSchema.parse(await response.json())),
  )
  assert.equal(new Set(results.map(({ id }) => id)).size, 1)
  assert.equal(results.filter(({ replayed }) => !replayed).length, 1)
  assert.equal((await app.transactions.recent(owner)).length, 1)
  const [{ id }] = results

  const otherResult = await post({ ...body, telegramUserId: other })
  assert.equal(otherResult.status, 201)
  assert.notEqual(structuredOperationResultSchema.parse(await otherResult.json()).id, id)

  const legacyKey = `telegram:${randomUUID()}`
  const legacy = await app.transactions.recordOperation(
    owner,
    { description: '', kind: 'expense', amountKopecks: 40_000n },
    legacyKey,
  )
  assert.equal(legacy.status, 'created')
  const legacyResponse = await post({ ...body, idempotencyKey: legacyKey })
  assert.equal(legacyResponse.status, 200)
  assert.equal(structuredOperationResultSchema.parse(await legacyResponse.json()).id, legacy.id)

  assert.equal(await app.transactions.remove(owner, id), true)
  const recovered = await post(body)
  assert.equal(recovered.status, 200)
  assert.deepEqual(structuredOperationResultSchema.parse(await recovered.json()), {
    id,
    kind: 'expense',
    categoryId: null,
    categoryName: null,
    replayed: true,
    deleted: true,
  })
  const lookup = await readReplay(body.telegramUserId, body.idempotencyKey)
  assert.equal(lookup.status, 200)
  assert.equal(structuredOperationResultSchema.parse(await lookup.json()).deleted, true)
  assert.equal(await app.transactions.getOperation(owner, id), null)
  await expectError(await patch(id, body.telegramUserId, null), 404, 'operation_unavailable')
  assert.equal(
    (
      await pool.query('SELECT id FROM transactions WHERE user_id = $1 AND idempotency_key = $2', [
        owner,
        body.idempotencyKey,
      ])
    ).rowCount,
    1,
  )
})

test('structured writes reject invalid money and dates before creating a transaction', async (t) => {
  const { app, post } = await start(t)
  const body = request()
  const owner = await app.users.getOrCreateUser(body.telegramUserId)
  for (const amountKopecks of ['0', '9223372036854775808', 40000]) {
    await expectError(await post({ ...body, amountKopecks }), 400, 'invalid_operation')
  }
  await expectError(await post({ ...body, currency: 'USD' }), 400, 'invalid_operation')
  for (const operationDate of [
    { date: '2026-11-25', timeZone },
    { date: '2011-12-30', timeZone: 'Pacific/Apia' },
    { date: '2026-11-17', timeZone: 'Unknown/Zone' },
  ]) {
    await expectError(await post({ ...body, operationDate }), 400, 'date_invalid')
  }
  assert.equal((await app.transactions.recent(owner)).length, 0)
})

test('operation batches roll back all rows and concurrent retries replay the same records', async (t) => {
  const { app, pool, postBatch } = await start(t)
  const { telegramUserId, idempotencyKey, ...row } = request()
  const userId = await app.users.getOrCreateUser(telegramUserId)
  const invalid = await postBatch({
    telegramUserId,
    idempotencyKey,
    rows: [row, { ...row, categoryId: randomUUID() }],
  })
  assert.equal(invalid.status, 409)
  assert.deepEqual(await invalid.json(), { error: 'category_unavailable', row: 1 })
  const list = () =>
    pool.query(
      'SELECT amount_kopecks, category_id FROM transactions WHERE user_id = $1 ORDER BY idempotency_key',
      [userId],
    )
  assert.equal((await list()).rowCount, 0)

  const batch = {
    telegramUserId,
    idempotencyKey,
    rows: [row, { ...row, amountKopecks: '57000', description: '' }],
  }
  const results = await Promise.all([postBatch(batch), postBatch(batch)])
  assert.deepEqual(results.map(({ status }) => status).sort(), [200, 201])
  const [first, second] = await Promise.all(
    results.map(async (response) => {
      const { rows } = (await response.json()) as { rows: unknown[] }
      return rows.map((value) => structuredOperationResultSchema.parse(value).id)
    }),
  )
  assert.deepEqual(first, second)
  assert.deepEqual((await list()).rows, [
    { amount_kopecks: '40000', category_id: null },
    { amount_kopecks: '57000', category_id: null },
  ])

  const conflict = await postBatch({ ...batch, rows: [...batch.rows, row] })
  assert.equal(conflict.status, 409)
  assert.equal((await list()).rowCount, 2)
})
