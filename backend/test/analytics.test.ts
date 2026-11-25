import assert from 'node:assert/strict'
import { createHmac, randomInt, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { test } from 'node:test'
import { starterCategories } from '../packages/shared/categories/starter-categories.ts'
import { createAnalyticsServer } from '../services/core/analytics/http.ts'
import { createAnalyticsOverview } from '../services/core/analytics/service.ts'
import type { AnalyticsOverview } from '../services/core/analytics/types.ts'
import { createApplication } from '../services/core/app.ts'
import { createDatabase } from '../services/core/db/client.ts'
import { createTransactionsHandler } from '../services/core/transactions/http.ts'
import { readTimeZone } from '../services/core/users/repository.ts'

test('Mini App history isolates users and records a backdated operation once across concurrent retries', async (t) => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must point to a migrated test database')
  const { db, pool } = createDatabase(process.env.DATABASE_URL)
  t.after(() => pool.end())
  const {
    analytics,
    telegram: { users, categories, transactions },
  } = createApplication(db)
  const telegramId = randomInt(2 ** 40, 2 ** 41)
  const owner = await users.getOrCreateUser(telegramId)
  const other = await users.getOrCreateUser(telegramId + 1)
  await users.setTimeZone(owner, 'Asia/Yekaterinburg')
  const [category] = await categories.listCategories(owner, 'expense')
  const [foreignCategory] = await categories.listCategories(other, 'expense')

  const now = new Date('2026-11-30T20:00:00Z')
  const botToken = '1000000:synthetic-test-token'
  const server = createAnalyticsServer({
    botToken,
    now: () => now,
    ...analytics,
    handleTransactions: createTransactionsHandler(db, users),
  })
  server.listen(0, '127.0.0.1')
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())))
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const endpoint = `http://127.0.0.1:${address.port}/api/transactions`

  const operation = {
    requestId: randomUUID(),
    kind: 'expense',
    amountKopecks: '41050',
    description: 'Тестовый расход',
    date: '2026-11-30',
    categoryId: category.id,
  }

  function request(id: number, query = '', body?: typeof operation) {
    const authDate = String(Math.floor(now.getTime() / 1000))
    const user = JSON.stringify({ id })
    const key = createHmac('sha256', 'WebAppData').update(botToken).digest()
    const hash = createHmac('sha256', key)
      .update(`auth_date=${authDate}\nuser=${user}`)
      .digest('hex')
    const initData = new URLSearchParams({ user, auth_date: authDate, hash }).toString()
    return fetch(endpoint + query, {
      method: body ? 'POST' : 'GET',
      headers: { 'X-Telegram-Init-Data': initData, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
  }

  assert.equal((await fetch(endpoint)).status, 401)
  assert.equal(
    (await request(telegramId, '', { ...operation, categoryId: foreignCategory.id })).status,
    409,
  )
  assert.equal((await request(telegramId, '', { ...operation, date: '2026-12-02' })).status, 400)
  const saves = await Promise.all([
    request(telegramId, '', operation),
    request(telegramId, '', operation),
  ])
  assert.deepEqual(
    saves.map((response) => response.status),
    [204, 204],
  )
  const current = await (await request(telegramId)).json()
  assert.equal(current.month, '2026-12')
  assert.deepEqual(current.operations, [])
  const history = await (await request(telegramId, '?month=2026-11')).json()
  assert.equal(history.operations.length, 1)
  assert.equal(history.operations[0].date, operation.date)
  assert.equal(history.operations[0].amountKopecks, operation.amountKopecks)
  assert.equal(history.operations[0].time, null)
  assert.equal(history.operations[0].categoryName, category.name)
  assert.deepEqual((await (await request(telegramId + 1, '?month=2026-11')).json()).operations, [])
  const stored = await transactions.getOperation(owner, history.operations[0].id)
  assert.equal(stored?.operationDate.date, operation.date)
})

test('the saved profile time zone controls the active month without rewriting operations', async (t) => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must point to a migrated test database')
  const { db, pool } = createDatabase(process.env.DATABASE_URL)
  t.after(() => pool.end())
  const {
    telegram: { users, transactions },
    analytics: { loadOverview },
  } = createApplication(db)
  const telegramId = randomInt(2 ** 40, 2 ** 41)
  const owner = await users.getOrCreateUser(telegramId)
  const other = await users.getOrCreateUser(telegramId + 1)
  const now = new Date('2026-11-30T21:30:00Z')
  const expenseAt = '2026-11-30T21:00:00Z'
  const {
    rows: [expense],
  } = await pool.query<{ id: string }>(
    `
    INSERT INTO transactions (user_id, kind, amount_kopecks, description, occurred_at, idempotency_key)
    VALUES ($1, 'expense', 10000, 'кофе', $2, $3) RETURNING id`,
    [owner, expenseAt, randomUUID()],
  )

  const fallback = await loadOverview(owner, 'current-month', now)
  assert.equal(fallback.usesUtcFallback, true)
  assert.equal(fallback.budget.month, '2026-11-01')

  assert.deepEqual(await users.setTimeZone(owner, 'asia/yekaterinburg'), {
    timeZone: 'Asia/Yekaterinburg',
  })
  assert.equal(await users.setTimeZone(owner, '+05:00'), 'invalid')
  assert.equal(await users.setTimeZone(owner, 'Mars/Base'), 'invalid')
  assert.equal(await users.getTimeZone(other), null)
  assert.equal(await users.setTimeZone(randomUUID(), 'UTC'), 'unavailable')
  const changed = await loadOverview(owner, 'current-month', now)
  assert.equal(changed.timeZone, 'Asia/Yekaterinburg')
  assert.equal(changed.usesUtcFallback, false)
  assert.equal(changed.budget.month, '2026-12-01')
  assert.equal(changed.budget.spentKopecks, '10000')
  assert.equal(changed.operationCount, 1)
  const week = await loadOverview(owner, 'current-week', now)
  assert.deepEqual([week.startDate, week.endDate], ['2026-11-30', '2026-12-01'])
  assert.equal(week.budget.month, '2026-11-01')
  assert.equal(week.budget.spentKopecks, '10000')
  assert.equal(week.operationCount, 1)
  const range = { startDate: '2026-11-29', endDate: '2026-11-30' }
  const custom = await loadOverview(owner, 'custom', now, range)
  assert.deepEqual([custom.startDate, custom.endDate], [range.startDate, range.endDate])
  assert.equal(custom.days.length, 2)
  assert.equal(custom.operationCount, 0)
  assert.equal(custom.budget.month, '2026-11-01')
  assert.equal(custom.budget.spentKopecks, '0')
  assert.equal(
    (await transactions.getOperation(owner, expense.id))?.operationDate.date,
    '2026-12-01',
  )
  const {
    rows: [stored],
  } = await pool.query<{ occurred_at: Date }>(
    'SELECT occurred_at FROM transactions WHERE id = $1',
    [expense.id],
  )
  assert.equal(stored.occurred_at.toISOString(), new Date(expenseAt).toISOString())

  assert.deepEqual(await users.setTimeZone(owner, 'UTC'), { timeZone: 'UTC' })
  assert.equal((await loadOverview(owner, 'current-month', now)).usesUtcFallback, false)
  assert.deepEqual(await users.setTimeZone(owner, null), { timeZone: null })
  assert.equal((await loadOverview(owner, 'current-month', now)).usesUtcFallback, true)
})

test('PostgreSQL analytics match bot dates across a repeated midnight and separate Telegram owners', async (t) => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must point to a migrated test database')
  const { db, pool } = createDatabase(process.env.DATABASE_URL)
  t.after(() => pool.end())
  const {
    telegram: { users, transactions, budgets },
    analytics,
  } = createApplication(db)
  const telegramId = randomInt(2 ** 40, 2 ** 41)
  const owner = await users.getOrCreateUser(telegramId)
  const other = await users.getOrCreateUser(telegramId + 1)
  const timeZone = 'America/Havana'
  await pool.query('UPDATE users SET time_zone = $1 WHERE id = $2', [timeZone, owner])

  const [archivedCafe, activeCafe] = [randomUUID(), randomUUID()].sort()
  const bar = randomUUID()
  const salary = randomUUID()
  await pool.query(
    `INSERT INTO categories (id, user_id, kind, name, archived_at) VALUES
    ($1, $4, 'expense', 'Кафе', '2020-10-01T12:00:00Z'),
    ($2, $4, 'expense', 'Кафе', NULL), ($3, $4, 'expense', 'Бар', NULL),
    ($5, $4, 'income', 'Зарплата', NULL)`,
    [archivedCafe, activeCafe, bar, owner, salary],
  )

  async function record(
    date: string,
    amount: number | bigint,
    kind: 'expense' | 'income' = 'expense',
    categoryId: string | null = null,
    userId = owner,
  ) {
    const {
      rows: [row],
    } = await pool.query<{ id: string }>(
      `
      INSERT INTO transactions (user_id, kind, amount_kopecks, description, occurred_at, idempotency_key, category_id)
      VALUES ($1, $2, $3, 'тестовая операция', $4, $5, $6) RETURNING id`,
      [userId, kind, amount, date, randomUUID(), categoryId],
    )
    return row.id
  }

  await record('2020-10-27T03:59:59.999999Z', 17)
  await record('2020-10-27T04:00:00Z', 600)
  await record('2020-11-01T03:59:59.999999Z', 1000, 'income')
  await record('2020-11-01T04:00:00Z', 9_223_372_036_854_775_807n, 'income', salary)
  await record('2020-11-01T05:00:00Z', 9_223_372_036_854_775_807n, 'income')
  const toDelete = await record('2020-11-01T04:30:00Z', 100, 'expense', archivedCafe)
  await record('2020-11-01T05:30:00Z', 100, 'expense', activeCafe)
  await record('2020-11-01T06:30:00Z', 100, 'expense', bar)
  await record('2020-11-01T12:00:00Z', 700)
  await record('2020-11-02T04:59:59.999999Z', 300)
  await record('2020-11-03T04:59:59.999999Z', 200)
  await record('2020-11-03T05:00:00Z', 13)
  await transactions.remove(owner, await record('2020-11-02T12:00:00Z', 555))
  await record('2020-11-01T01:00:00Z', 777, 'income', null, other)

  assert.equal(
    await budgets.changeBudgetLimit(
      owner,
      '2020-10-01',
      null,
      { kind: 'set', amountKopecks: 2000n },
      new Date('2020-10-20T12:00:00Z'),
    ),
    'saved',
  )
  assert.equal(
    await budgets.changeBudgetLimit(
      owner,
      '2020-11-01',
      null,
      { kind: 'set', amountKopecks: 3000n },
      new Date('2020-11-03T04:59:59Z'),
    ),
    'saved',
  )
  assert.equal(
    await budgets.changeBudgetLimit(
      owner,
      '2020-11-01',
      activeCafe,
      { kind: 'set', amountKopecks: 80n },
      new Date('2020-11-03T04:59:59Z'),
    ),
    'saved',
  )

  const now = new Date('2020-11-03T04:59:59Z')
  const botToken = '1000000:synthetic-test-token'
  const server = createAnalyticsServer({ botToken, now: () => now, ...analytics })
  server.listen(0, '127.0.0.1')
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())))
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const endpoint = `http://127.0.0.1:${address.port}/api/analytics/overview`

  async function overview(period: string, id = telegramId, ignoredUserId = other) {
    const authDate = String(Math.floor(now.getTime() / 1000))
    const user = JSON.stringify({ id })
    const key = createHmac('sha256', 'WebAppData').update(botToken).digest()
    const hash = createHmac('sha256', key)
      .update(`auth_date=${authDate}\nuser=${user}`)
      .digest('hex')
    const initData = new URLSearchParams({ user, auth_date: authDate, hash }).toString()
    const response = await fetch(`${endpoint}?period=${period}&userId=${ignoredUserId}`, {
      headers: { 'X-Telegram-Init-Data': initData },
    })
    assert.equal(response.status, 200)
    return (await response.json()) as AnalyticsOverview
  }

  const incomeCategories = [
    { id: null, name: 'Без категории', amountKopecks: '9223372036854775807' },
    { id: salary, name: 'Зарплата', amountKopecks: '9223372036854775807' },
  ]
  const current = await overview('current-month')
  assert.deepEqual(current, {
    period: 'current-month',
    startDate: '2020-11-01',
    endDate: '2020-11-02',
    timeZone,
    usesUtcFallback: false,
    currency: 'RUB',
    operationCount: 8,
    budget: {
      month: '2020-11-01',
      spentKopecks: '1513',
      limitKopecks: '3000',
      categories: [{ id: activeCafe, name: 'Кафе', spentKopecks: '100', limitKopecks: '80' }],
    },
    totals: {
      incomeKopecks: '18446744073709551614',
      expenseKopecks: '1500',
      differenceKopecks: '18446744073709550114',
    },
    days: [
      { date: '2020-11-01', incomeKopecks: '18446744073709551614', expenseKopecks: '1300' },
      { date: '2020-11-02', incomeKopecks: '0', expenseKopecks: '200' },
    ],
    expenseCategoriesByDay: {
      '2020-11-01': [
        { id: null, name: 'Без категории', amountKopecks: '1000' },
        { id: bar, name: 'Бар', amountKopecks: '100' },
        { id: archivedCafe, name: 'Кафе', amountKopecks: '100' },
        { id: activeCafe, name: 'Кафе', amountKopecks: '100' },
      ],
      '2020-11-02': [{ id: null, name: 'Без категории', amountKopecks: '200' }],
    },
    expenseCategories: [
      { id: null, name: 'Без категории', amountKopecks: '1200' },
      { id: bar, name: 'Бар', amountKopecks: '100' },
      { id: archivedCafe, name: 'Кафе', amountKopecks: '100' },
      { id: activeCafe, name: 'Кафе', amountKopecks: '100' },
    ],
    incomeCategories,
    incomeCategoriesByDay: { '2020-11-01': incomeCategories },
  })
  const dayFromBot = await transactions.dailyHistory(owner, '2020-11-01', timeZone)
  assert.equal(dayFromBot.length, 7)
  assert.equal(
    dayFromBot
      .filter(({ kind }) => kind === 'expense')
      .reduce((subtotal, { amountKopecks }) => subtotal + amountKopecks, 0n)
      .toString(),
    current.days[0].expenseKopecks,
  )

  const recent = await overview('last-7-days')
  assert.equal(recent.startDate, '2020-10-27')
  assert.equal(recent.endDate, '2020-11-02')
  assert.equal(recent.days.length, 7)
  assert.deepEqual(recent.days[0], {
    date: '2020-10-27',
    incomeKopecks: '0',
    expenseKopecks: '600',
  })
  assert.deepEqual(recent.days[1], { date: '2020-10-28', incomeKopecks: '0', expenseKopecks: '0' })
  assert.equal(recent.operationCount, 10)
  assert.deepEqual(recent.budget, {
    month: '2020-10-01',
    spentKopecks: '2130',
    limitKopecks: '5000',
    categories: current.budget.categories,
  })

  const previous = await overview('previous-month')
  assert.equal(previous.startDate, '2020-10-01')
  assert.deepEqual(previous.budget, {
    month: '2020-10-01',
    spentKopecks: '617',
    limitKopecks: '2000',
    categories: [],
  })
  assert.equal(previous.endDate, '2020-10-31')
  assert.deepEqual(previous.days.at(-1), {
    date: '2020-10-31',
    incomeKopecks: '1000',
    expenseKopecks: '0',
  })
  assert.deepEqual(previous.totals, {
    incomeKopecks: '1000',
    expenseKopecks: '617',
    differenceKopecks: '383',
  })
  const zeroExpenseCategories = [
    { id: bar, name: 'Бар', amountKopecks: '0' },
    { id: activeCafe, name: 'Кафе', amountKopecks: '0' },
  ]
  assert.deepEqual(previous.expenseCategories, [
    { id: null, name: 'Без категории', amountKopecks: '617' },
    ...zeroExpenseCategories,
  ])

  const emptyDay = await analytics.loadOverview(owner, 'custom', now, {
    startDate: '2020-10-28',
    endDate: '2020-10-28',
  })
  assert.equal(emptyDay.totals.expenseKopecks, '0')
  assert.deepEqual(emptyDay.expenseCategories, zeroExpenseCategories)
  assert.deepEqual(emptyDay.expenseCategoriesByDay, {})

  const threeMonths = await analytics.loadOverview(owner, 'custom', now, {
    startDate: '2020-10-31',
    endDate: '2020-12-01',
  })
  assert.deepEqual(threeMonths.budget, {
    month: '2020-10-01',
    spentKopecks: '2130',
    limitKopecks: '8000',
    categories: [{ id: activeCafe, name: 'Кафе', spentKopecks: '100', limitKopecks: '160' }],
  })

  const missingLimit = await analytics.loadOverview(owner, 'custom', now, {
    startDate: '2020-09-30',
    endDate: '2020-10-01',
  })
  assert.deepEqual(missingLimit.budget, {
    month: '2020-09-01',
    spentKopecks: '617',
    limitKopecks: null,
    categories: [],
  })

  const isolated = await overview('current-month', telegramId + 1, owner)
  assert.equal(isolated.endDate, '2020-11-03')
  assert.equal(isolated.timeZone, 'UTC')
  assert.equal(isolated.usesUtcFallback, true)
  assert.equal(isolated.operationCount, 1)
  assert.deepEqual(isolated.totals, {
    incomeKopecks: '777',
    expenseKopecks: '0',
    differenceKopecks: '777',
  })
  const starterExpenses = starterCategories.expense.map(({ key, name }) => ({
    id: `starter:${key}`,
    name,
    amountKopecks: '0',
  }))
  assert.deepEqual(isolated.expenseCategories, starterExpenses)
  assert.deepEqual(isolated.budget, {
    month: '2020-11-01',
    spentKopecks: '0',
    limitKopecks: null,
    categories: [],
  })

  const empty = await overview('current-month', telegramId + 2, owner)
  assert.equal(empty.operationCount, 0)
  assert.deepEqual(empty.expenseCategories, starterExpenses)
  assert.deepEqual(empty.totals, {
    incomeKopecks: '0',
    expenseKopecks: '0',
    differenceKopecks: '0',
  })
  assert.equal(
    (await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId + 2])).rowCount,
    0,
  )

  await transactions.remove(owner, toDelete)
  const refreshed = await overview('current-month')
  assert.equal(refreshed.operationCount, 7)
  assert.equal(refreshed.totals.expenseKopecks, '1400')
  assert.equal(refreshed.budget.spentKopecks, '1413')
  assert.equal(refreshed.days[0].expenseKopecks, '1200')
  assert.ok(!refreshed.expenseCategories.some(({ id }) => id === archivedCafe))
})

test('analytics include all of the local day even when spring daylight saving skips midnight', async (t) => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must point to a migrated test database')
  const { db, pool } = createDatabase(process.env.DATABASE_URL)
  t.after(() => pool.end())
  const telegramId = randomInt(2 ** 40, 2 ** 41)
  const {
    telegram: { users },
    analytics: { loadOverview },
  } = createApplication(db)
  const owner = await users.getOrCreateUser(telegramId)
  await pool.query('UPDATE users SET time_zone = $1 WHERE id = $2', ['America/Havana', owner])

  const boundaries = [
    ['2020-03-08T04:59:59.999999Z', 1],
    ['2020-03-08T05:00:00Z', 2],
    ['2020-03-09T03:59:59.999999Z', 4],
    ['2020-03-09T04:00:00Z', 8],
  ] as const
  for (const [instant, amount] of boundaries) {
    await pool.query(
      `INSERT INTO transactions (user_id, kind, amount_kopecks, description, occurred_at, idempotency_key)
      VALUES ($1, 'expense', $2, 'тестовая операция', $3, $4)`,
      [owner, amount, instant, randomUUID()],
    )
  }

  const result = await loadOverview(owner, 'current-month', new Date('2020-03-09T03:30:00Z'))
  assert.equal(result.endDate, '2020-03-08')
  assert.deepEqual(result.days.at(-1), {
    date: '2020-03-08',
    incomeKopecks: '0',
    expenseKopecks: '6',
  })
  assert.deepEqual(result.totals, {
    incomeKopecks: '0',
    expenseKopecks: '7',
    differenceKopecks: '-7',
  })
  assert.equal(result.operationCount, 3)
})

test('analytics use a single snapshot after concurrent changes to profile, budget and operations', async (t) => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must point to a migrated test database')
  const { db, pool } = createDatabase(process.env.DATABASE_URL)
  t.after(() => pool.end())
  const {
    telegram: { users, transactions, budgets, categories },
    analytics: { loadOverview },
  } = createApplication(db)
  const owner = await users.getOrCreateUser(randomInt(2 ** 40, 2 ** 41))
  const now = new Date('2026-11-15T16:00:00Z')
  const before = await loadOverview(owner, 'current-month', now)

  const loadDuringUpdate = createAnalyticsOverview(db, async (connection, userId) => {
    const timeZone = await readTimeZone(connection, userId)
    // The profile SELECT has established the snapshot. Commit changes through separate connections.
    assert.deepEqual(await users.setTimeZone(owner, 'Asia/Yekaterinburg'), {
      timeZone: 'Asia/Yekaterinburg',
    })
    assert.equal(
      await budgets.changeBudgetLimit(
        owner,
        '2026-11-01',
        null,
        {
          kind: 'set',
          amountKopecks: 1_000n,
        },
        now,
      ),
      'saved',
    )
    const operation = await transactions.recordOperation(
      owner,
      {
        kind: 'expense',
        description: 'тестовая операция',
        amountKopecks: 100n,
        operationDate: { date: '2026-11-15', timeZone: 'UTC' },
      },
      randomUUID(),
    )
    assert.equal(operation.status, 'created')
    return timeZone
  })

  assert.deepEqual(await loadDuringUpdate(owner, 'current-month', now), before)
  const after = await loadOverview(owner, 'current-month', now)
  assert.equal(after.timeZone, 'Asia/Yekaterinburg')
  assert.equal(after.budget.limitKopecks, '1000')
  assert.equal(after.budget.spentKopecks, '100')
  assert.equal(after.days.at(-1)?.expenseKopecks, '100')
  assert.deepEqual(after.expenseCategories, [
    { id: null, name: 'Без категории', amountKopecks: '100' },
    ...(await categories.listCategories(owner, 'expense')).map((category) => ({
      ...category,
      amountKopecks: '0',
    })),
  ])
})
