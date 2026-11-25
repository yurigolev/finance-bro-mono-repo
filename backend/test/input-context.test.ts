import assert from 'node:assert/strict'
import { randomInt, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { test } from 'node:test'
import { createApplication } from '../services/core/app.ts'
import { categoryMatchingContextSchema } from '../packages/contracts/input.ts'
import { matchOperationCategories } from '../packages/shared/categories/matching.ts'
import { saveRule } from '../services/core/categories/repository.ts'
import { createLoadInputContext } from '../services/core/categories/service.ts'
import { createCoreServer, createInternalHandler } from '../services/core/http/server.ts'
import { createDatabase } from '../services/core/db/client.ts'
import type { OperationKind } from '../packages/contracts/transactions.ts'
import { createUserRepository } from '../services/core/users/repository.ts'

test('category context preserves exact, phrase, disabled, archived and mixed-kind matching', async (t) => {
  const connectionString = process.env.DATABASE_URL
  assert.ok(connectionString, 'DATABASE_URL must point to a migrated test database')
  const { db, pool } = createDatabase(connectionString)
  t.after(() => pool.end())

  const { users, categories, transactions } = createApplication(db).telegram
  const userId = await users.getOrCreateUser(randomInt(2 ** 40, 2 ** 41))
  await users.setTimeZone(userId, 'Asia/Yekaterinburg')
  const loadInputContext = createLoadInputContext(db)
  const defaults = await loadInputContext(userId)
  assert.equal(defaults.timeZone, 'Asia/Yekaterinburg')
  const cafe = defaults.categories.find(({ key }) => key === 'dining')
  assert.ok(cafe)
  assert.ok(categoryMatchingContextSchema.safeParse(defaults).success)

  await categories.addCategory(userId, 'expense', 'Транспорт')
  await categories.addCategory(userId, 'expense', 'Поездки')
  await categories.addCategory(userId, 'income', 'Транспорт')
  const transport = (await categories.listCategories(userId, 'expense')).find(
    ({ name }) => name === 'Транспорт',
  )
  const trips = (await categories.listCategories(userId, 'expense')).find(
    ({ name }) => name === 'Поездки',
  )
  assert.ok(transport && trips)
  assert.ok(await categories.changeBuiltInRule(userId, 'expense', 'хата', null))
  assert.ok(await categories.changeBuiltInRule(userId, 'expense', 'мебель для дома', trips.id))
  assert.ok(await categories.archiveCategory(userId, trips.id))
  // Migrated spellings can coexist before a rule is edited in the app.
  await saveRule(db, userId, 'expense', 'пятёрочка', transport.id)
  await saveRule(db, userId, 'expense', 'пятерочка', null)
  await saveRule(db, userId, 'expense', 'платёж по ипотеке', transport.id)
  await saveRule(db, userId, 'expense', 'платеж по ипотеке', cafe.id)

  const context = await loadInputContext(userId)
  assert.ok(context.categoryRules.some(({ categoryId }) => categoryId === trips.id))
  assert.ok(context.categoryRules.some(({ categoryId }) => categoryId === null))
  assert.ok(!context.categories.some(({ id }) => id === trips.id))
  assert.deepEqual(
    matchOperationCategories(context, {
      description: 'Платёж по ипотеке',
    }).categoryCandidates.map(({ id }) => id),
    [cafe.id],
  )
  const scenarios: { kind?: OperationKind; description: string }[] = [
    { kind: 'expense', description: ' ТРАНСПОРТ ' },
    { kind: 'expense', description: 'проект и кофе' },
    { kind: 'expense', description: 'утром в кафе и в метро' },
    { kind: 'expense', description: 'хата' },
    { kind: 'expense', description: 'мебель для дома' },
    { description: 'хата' },
    { description: 'мебель для дома' },
    { description: 'проекты' },
    { description: 'транспорт' },
    { description: 'метро и проект' },
    { kind: 'expense', description: 'ПЯТЁРОЧКА' },
    { kind: 'expense', description: 'покупка в пятёрочке' },
    { kind: 'expense', description: 'вечером в пятёрочка' },
    { description: 'Платёж по ипотеке' },
    { kind: 'expense', description: 'сегодня платёж по ипотеке' },
  ]
  for (const draft of scenarios) {
    const actual = matchOperationCategories(context, draft)
    const key = randomUUID()
    const expected = await transactions.recordOperation(
      userId,
      { ...draft, amountKopecks: 40_000n },
      key,
    )

    if (expected.status === 'kind-required') {
      assert.equal(actual.kind, undefined, draft.description)
      continue
    }
    assert.equal(expected.status, 'created')
    assert.equal(actual.kind, expected.kind, draft.description)
    assert.deepEqual(
      actual.categoryCandidates.map(({ name }) => name),
      expected.categoryChoices?.map(({ name }) => name) ??
        (expected.categoryName ? [expected.categoryName] : []),
      draft.description,
    )
  }
})

test('category context seeds a fresh catalogue but preserves an entirely archived one', async (t) => {
  const connectionString = process.env.DATABASE_URL
  assert.ok(connectionString, 'DATABASE_URL must point to a migrated test database')
  const { db, pool } = createDatabase(connectionString)
  t.after(() => pool.end())

  const { users, categories, transactions } = createApplication(db).telegram
  const userId = await users.getOrCreateUser(randomInt(2 ** 40, 2 ** 41))
  const loadInputContext = createLoadInputContext(db)
  const fresh = await loadInputContext(userId)
  assert.equal(fresh.timeZone, 'UTC')
  assert.ok(fresh.categories.length > 0)
  for (const { id } of fresh.categories)
    assert.equal(await categories.archiveCategory(userId, id), true)

  const archived = await loadInputContext(userId)
  assert.deepEqual(archived, { timeZone: 'UTC', categories: [], categoryRules: [] })
  const draft = { description: 'кофе', amountKopecks: 40_000n }
  assert.deepEqual(matchOperationCategories(archived, draft), {
    kind: undefined,
    categoryCandidates: [],
  })
  assert.deepEqual(await transactions.recordOperation(userId, draft, randomUUID()), {
    status: 'kind-required',
  })
})

test('core context HTTP requires service auth and returns only the requested owner snapshot', async (t) => {
  const connectionString = process.env.DATABASE_URL
  assert.ok(connectionString, 'DATABASE_URL must point to a migrated test database')
  const { db, pool } = createDatabase(connectionString)
  const app = createApplication(db)
  const token = randomUUID()
  const server = createCoreServer(
    db,
    {
      botToken: 'test-bot-token',
      maxAgeSeconds: 3600,
      handleInternal: createInternalHandler(db, app, token),
    },
    app,
  )
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await pool.end()
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const baseUrl = `http://127.0.0.1:${address.port}`
  const telegramId = randomInt(2 ** 40, 2 ** 41)
  const path = `${baseUrl}/internal/v1/users/${telegramId}/input-context`
  const request = (authorization?: string) =>
    fetch(path, authorization ? { headers: { Authorization: authorization } } : undefined)

  for (const header of [undefined, 'Bearer invalid', `Basic ${token}`]) {
    const response = await request(header)
    assert.equal(response.status, 401)
    assert.deepEqual(await response.json(), { error: 'invalid_service_authorization' })
  }
  assert.equal(await createUserRepository(db).findUserIdByTelegramId(telegramId), null)

  const { users, categories } = app.telegram
  const owner = await users.getOrCreateUser(telegramId)
  const other = await users.getOrCreateUser(telegramId + 1)
  await users.setTimeZone(owner, 'Asia/Yekaterinburg')
  await categories.addCategory(owner, 'expense', 'Личная категория')
  await categories.addCategory(other, 'expense', 'Чужая категория')
  const response = await request(`Bearer ${token}`)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const payload = await response.json()
  assert.deepEqual(payload, await createLoadInputContext(db)(owner))
  assert.equal(payload.timeZone, 'Asia/Yekaterinburg')
  assert.ok(payload.categories.some((entry: { name: string }) => entry.name === 'Личная категория'))
  assert.ok(!payload.categories.some((entry: { name: string }) => entry.name === 'Чужая категория'))

  const headers = { Authorization: `Bearer ${token}` }
  const invalid = await fetch(`${baseUrl}/internal/v1/users/1e9/input-context`, { headers })
  assert.equal(invalid.status, 400)
  assert.deepEqual(await invalid.json(), { error: 'invalid_telegram_user' })
  const wrongMethod = await fetch(path, { method: 'POST', headers })
  assert.equal(wrongMethod.status, 405)
  assert.equal(wrongMethod.headers.get('allow'), 'GET')
  assert.deepEqual(await wrongMethod.json(), { error: 'method_not_allowed' })

  const settings = await fetch(`${baseUrl}/api/settings`, { headers })
  assert.equal(settings.status, 401)
  assert.deepEqual(await settings.json(), { error: 'invalid_telegram_init_data' })
})
