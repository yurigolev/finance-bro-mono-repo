import assert from 'node:assert/strict'
import { randomInt, randomUUID } from 'node:crypto'
import { test, type TestContext } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { and, eq } from 'drizzle-orm'
import { createApplication } from '../services/core/app.ts'
import { createDatabase } from '../services/core/db/client.ts'
import { transactions } from '../services/core/db/schema.ts'
import { insertOperation } from '../services/core/transactions/repository.ts'
import type { RecordOperationResult } from '../packages/contracts/transactions.ts'

function connect(t: TestContext, connectionString = process.env.DATABASE_URL) {
  assert.ok(connectionString, 'DATABASE_URL must point to a migrated test database')
  const { db, pool } = createDatabase(connectionString)
  t.after(() => pool.end())
  return { db, pool, app: createApplication(db).telegram }
}

const expense = { kind: 'expense', amountKopecks: 48_050n, description: 'кофе' } as const
const income = {
  kind: 'income',
  amountKopecks: 9_223_372_036_854_775_807n,
  description: 'проект',
} as const

function created(result: RecordOperationResult) {
  assert.equal(result.status, 'created')
  return result
}

test('monthly limits repeat, keep prior values, and respect category ownership and archival', async (t) => {
  const { app, pool } = connect(t)
  const telegramId = randomInt(2 ** 40, 2 ** 41)
  const owner = await app.users.getOrCreateUser(telegramId)
  const other = await app.users.getOrCreateUser(telegramId + 1)
  const [category] = await app.categories.listCategories(owner, 'expense')
  const [incomeCategory] = await app.categories.listCategories(owner, 'income')
  const november = '2025-11-01'
  const december = '2025-12-01'
  const january = '2026-01-01'
  const setLimit = (
    userId: string,
    month: string,
    categoryId: string | null,
    amountKopecks: bigint,
  ) =>
    app.budgets.changeBudgetLimit(
      userId,
      month,
      categoryId,
      { kind: 'set', amountKopecks },
      new Date(`${month}T12:00:00Z`),
    )
  assert.equal(await setLimit(other, november, category.id, 1n), 'unavailable')
  assert.equal(await setLimit(owner, november, incomeCategory.id, 1n), 'unavailable')
  assert.equal(await setLimit(owner, november, null, 60_000n), 'saved')
  assert.equal(await setLimit(owner, november, category.id, 8_000n), 'saved')
  const repeated = await app.budgets.monthlyBudget(owner, december, 'UTC')
  assert.equal(repeated.totalLimit, 60_000n)
  assert.deepEqual(repeated.categories, [
    { ...category, archived: false, limit: 8_000n, spent: 0n },
  ])
  assert.equal(await setLimit(owner, december, null, 65_000n), 'saved')
  assert.equal(await setLimit(owner, december, null, 70_000n), 'saved')
  assert.equal(await setLimit(owner, december, category.id, 10_000n), 'saved')
  assert.equal(
    await app.budgets.changeBudgetLimit(
      owner,
      january,
      null,
      { kind: 'disable' },
      new Date('2026-01-01T12:00:00Z'),
    ),
    'saved',
  )
  assert.equal((await app.budgets.monthlyBudget(owner, november, 'UTC')).totalLimit, 60_000n)
  assert.equal((await app.budgets.monthlyBudget(owner, december, 'UTC')).totalLimit, 70_000n)
  assert.equal((await app.budgets.monthlyBudget(owner, '2026-02-01', 'UTC')).totalLimit, null)

  await pool.query('UPDATE categories SET archived_at = $1 WHERE id = $2', [
    '2025-12-15T00:00:00Z',
    category.id,
  ])
  assert.equal(await setLimit(owner, january, category.id, 1n), 'unavailable')
  assert.deepEqual((await app.budgets.monthlyBudget(owner, december, 'UTC')).categories, [
    { ...category, archived: true, limit: 10_000n, spent: 0n },
  ])
  assert.equal(
    (await app.budgets.monthlyBudget(owner, november, 'UTC')).categories[0]?.limit,
    8_000n,
  )
  assert.deepEqual((await app.budgets.monthlyBudget(owner, january, 'UTC')).categories, [])
  assert.deepEqual(await app.budgets.monthlyBudget(other, november, 'UTC'), {
    totalSpent: 0n,
    totalLimit: null,
    categories: [],
  })

  assert.deepEqual(await app.users.setTimeZone(owner, 'Asia/Yekaterinburg'), {
    timeZone: 'Asia/Yekaterinburg',
  })
  const localDecember = new Date('2025-11-30T19:00:00Z')
  assert.equal(
    await app.budgets.changeBudgetLimit(owner, november, null, { kind: 'disable' }, localDecember),
    'stale',
  )
  assert.equal(
    await app.budgets.changeBudgetLimit(
      owner,
      january,
      null,
      { kind: 'set', amountKopecks: 1n },
      localDecember,
    ),
    'stale',
  )
  assert.equal(
    await app.budgets.changeBudgetLimit(
      owner,
      december,
      null,
      { kind: 'set', amountKopecks: 70_000n },
      localDecember,
    ),
    'saved',
  )
  assert.equal(
    (await app.budgets.monthlyBudget(owner, november, 'Asia/Yekaterinburg')).totalLimit,
    60_000n,
  )
  assert.equal(
    (await app.budgets.monthlyBudget(owner, january, 'Asia/Yekaterinburg')).totalLimit,
    null,
  )
})

test('monthly spending uses local dates across a repeated first midnight and reflects edits', async (t) => {
  const { app, pool } = connect(t)
  const telegramId = randomInt(2 ** 40, 2 ** 41)
  const owner = await app.users.getOrCreateUser(telegramId)
  const other = await app.users.getOrCreateUser(telegramId + 1)
  const [cafe, otherCategory] = await app.categories.listCategories(owner, 'expense')
  const month = '2020-11-01'
  for (const categoryId of [cafe.id, otherCategory.id]) {
    assert.equal(
      await app.budgets.changeBudgetLimit(
        owner,
        month,
        categoryId,
        { kind: 'set', amountKopecks: 1_000n },
        new Date('2020-11-15T12:00:00Z'),
      ),
      'saved',
    )
  }
  async function record(userId: string, at: string, amount: number, kind = 'expense') {
    const {
      rows: [row],
    } = await pool.query<{ id: string }>(
      `
      INSERT INTO transactions (user_id, kind, amount_kopecks, description, occurred_at, idempotency_key)
      VALUES ($1, $2, $3, 'покупка', $4, $5) RETURNING id`,
      [userId, kind, amount, at, randomUUID()],
    )
    return row.id
  }
  await record(owner, '2020-11-01T03:59:59.999999Z', 600)
  const categorized = await record(owner, '2020-11-01T04:00:00Z', 200)
  await app.categories.setCategory(owner, categorized, cafe.id)
  const uncategorized = await record(owner, '2020-11-01T05:00:00Z', 300)
  await record(owner, '2020-12-01T04:59:59.999999Z', 400)
  await record(owner, '2020-12-01T05:00:00Z', 700)
  await record(owner, '2020-11-05T12:00:00Z', 900, 'income')
  await record(other, '2020-11-05T12:00:00Z', 800)
  const localBudget = () => app.budgets.monthlyBudget(owner, month, 'America/Havana')
  assert.equal((await app.budgets.monthlyBudget(owner, month, 'UTC')).totalSpent, 1_100n)
  assert.equal((await localBudget()).totalSpent, 900n)
  assert.equal((await localBudget()).categories.find(({ id }) => id === cafe.id)?.spent, 200n)
  await app.categories.setCategory(owner, categorized, otherCategory.id)
  await app.transactions.remove(owner, uncategorized)
  const edited = await localBudget()
  assert.equal(edited.totalSpent, 600n)
  assert.equal(edited.categories.find(({ id }) => id === cafe.id)?.spent, 0n)
  assert.equal(edited.categories.find(({ id }) => id === otherCategory.id)?.spent, 200n)
})

test('daily history spans both repeated midnights and returns all active owner operations', async (t) => {
  const { app, pool } = connect(t)
  const telegramId = randomInt(2 ** 40, 2 ** 41)
  const owner = await app.users.getOrCreateUser(telegramId)
  const other = await app.users.getOrCreateUser(telegramId + 1)
  await pool.query('UPDATE users SET time_zone = $1 WHERE id = $2', ['America/Havana', owner])
  assert.equal(await app.users.getTimeZone(owner), 'America/Havana')
  assert.equal(await app.users.getTimeZone(other), null)

  async function insert(userId: string, occurredAt: string, key: string, deleted = false) {
    const {
      rows: [row],
    } = await pool.query<{ id: string }>(
      `
      INSERT INTO transactions (user_id, kind, amount_kopecks, description, occurred_at, idempotency_key, deleted_at)
      VALUES ($1, 'expense', 100, $3, $2, $3, CASE WHEN $4 THEN now() END) RETURNING id
    `,
      [userId, occurredAt, key, deleted],
    )
    return row.id
  }

  const first = await insert(owner, '2025-11-02T04:00:00Z', 'first local midnight')
  const secondMidnight = await insert(owner, '2025-11-02T05:00:00Z', 'second local midnight')
  const tied = await Promise.all(
    Array.from({ length: 8 }, (_, index) => insert(owner, '2025-11-02T17:00:00Z', `tied ${index}`)),
  )
  const last = await insert(owner, '2025-11-03T04:59:59.999999Z', 'last microsecond')
  await insert(owner, '2025-11-02T03:59:59.999999Z', 'previous local day')
  await insert(owner, '2025-11-03T05:00:00Z', 'next local day')
  await insert(other, '2025-11-02T17:00:00Z', 'another owner')
  await insert(owner, '2025-11-02T17:00:00Z', 'deleted', true)

  const history = await app.transactions.loadDailyHistory(owner, '2025-11-02')
  assert.ok(history)
  assert.equal(history.timeZone, 'America/Havana')
  assert.deepEqual(
    history.operations.map(({ id }) => id),
    [last, ...tied.sort().reverse(), secondMidnight, first],
  )
  assert.equal(await app.transactions.loadDailyHistory(owner, '9999-12-31'), null)
})

test('recording matches the whole active category name for the owner and operation kind', async (t) => {
  const { app } = connect(t)
  const telegramId = randomInt(2 ** 40, 2 ** 41)
  const owner = await app.users.getOrCreateUser(telegramId)
  const other = await app.users.getOrCreateUser(telegramId + 1)
  const key = `telegram:${randomUUID()}`
  const input = { ...expense, amountKopecks: 4300n, description: '  тРаНсПоРт  ' }
  const deliveries = await Promise.all([
    app.transactions.recordOperation(owner, input, key),
    app.transactions.recordOperation(owner, input, key),
  ])
  const matched = deliveries.find((entry) => entry.status === 'created')
  assert.ok(matched)
  assert.deepEqual(deliveries.map(({ status }) => status).sort(), ['created', 'duplicate'])
  assert.equal(matched.categoryName, '🚇 Транспорт')
  const saved = await app.transactions.getOperation(owner, matched.id)
  assert.equal(saved?.categoryName, '🚇 Транспорт')
  assert.equal(saved?.description, input.description)
  assert.equal(saved?.amountKopecks, 4300n)
  assert.equal(await app.categories.canRememberCategory(owner, 'expense', 'транспорт'), false)
  const withEmoji = created(
    await app.transactions.recordOperation(
      owner,
      { ...input, description: '🚇 Транспорт' },
      `telegram:${randomUUID()}`,
    ),
  )
  assert.equal(withEmoji.categoryName, '🚇 Транспорт')
  assert.equal(await app.categories.addCategory(owner, 'expense', 'Транспорт'), 'ok')
  const custom = created(
    await app.transactions.recordOperation(owner, input, `telegram:${randomUUID()}`),
  )
  assert.equal(custom.categoryName, 'Транспорт')
  const customCategory = (await app.categories.listCategories(owner, 'expense')).find(
    ({ name }) => name === 'Транспорт',
  )
  assert.ok(customCategory)
  assert.equal(await app.categories.archiveCategory(owner, customCategory.id), true)

  assert.equal(await app.categories.addCategory(other, 'expense', 'Самокат'), 'ok')
  for (const entry of [
    { ...income, description: 'транспорт' },
    { ...expense, description: 'электротранспорт' },
    { ...expense, description: 'самокат' },
  ]) {
    const recorded = created(
      await app.transactions.recordOperation(owner, entry, `telegram:${randomUUID()}`),
    )
    assert.equal(recorded.categoryName, null)
  }

  const transport = (await app.categories.listCategories(owner, 'expense')).find(
    ({ name }) => name === '🚇 Транспорт',
  )
  assert.ok(transport)
  assert.equal(await app.categories.archiveCategory(owner, transport.id), true)
  const afterArchive = created(
    await app.transactions.recordOperation(owner, input, `telegram:${randomUUID()}`),
  )
  assert.equal(afterArchive.categoryName, null)
  assert.equal(
    (await app.transactions.getOperation(owner, matched.id))?.categoryName,
    '🚇 Транспорт',
  )
  assert.equal(await app.transactions.remove(owner, matched.id), true)
  assert.deepEqual(await app.transactions.recordOperation(owner, input, key), {
    status: 'duplicate',
  })
  assert.deepEqual(
    await app.transactions.recordOperation(owner, { ...input, kind: undefined }, key),
    { status: 'duplicate' },
  )
})

test('category phrases handle custom categories, word boundaries and mixed operation kinds', async (t) => {
  const { app } = connect(t)
  const owner = await app.users.getOrCreateUser(randomInt(2 ** 40, 2 ** 41))
  for (const name of ['Курс испанского', 'Консультация']) {
    assert.equal(await app.categories.addCategory(owner, 'expense', name), 'ok')
  }
  const record = (description: string) =>
    app.transactions.recordOperation(
      owner,
      {
        description,
        amountKopecks: 100n,
      },
      randomUUID(),
    )
  const both = created(await record('оплатил курс испанского и консультацию'))
  assert.equal(both.kind, 'expense')
  assert.equal(both.categoryName, null)
  assert.deepEqual(both.categoryChoices?.map(({ name }) => name).sort(), [
    'Консультация',
    'Курс испанского',
    '🎓 Образование',
  ])
  assert.deepEqual(await record('это предконсультация'), { status: 'kind-required' })
  assert.deepEqual(await record('зарплата и консультация'), { status: 'kind-required' })
  const single = created(await record('вчерашняя консультация'))
  assert.equal(single.categoryName, 'Консультация')
  const travel = created(await record('кофе в путешествии'))
  assert.equal(travel.kind, 'expense')
  assert.deepEqual(
    travel.categoryChoices?.map(({ name }) => name).sort(),
    ['☕ Кафе', '✈️ Путешествия'].sort(),
  )
  const project = created(await record('за за проект'))
  assert.equal(project.categoryName, '🛠️ Проекты')
  assert.equal(project.categoryChoices, undefined)
})

test('remembered descriptions are personal, scoped by kind and use only active categories', async (t) => {
  const { app } = connect(t)
  const telegramId = randomInt(2 ** 40, 2 ** 41)
  const owner = await app.users.getOrCreateUser(telegramId)
  const other = await app.users.getOrCreateUser(telegramId + 1)
  const record = async (
    userId: string,
    input: Parameters<typeof app.transactions.recordOperation>[1],
  ) => created(await app.transactions.recordOperation(userId, input, `telegram:${randomUUID()}`))
  const first = await record(owner, {
    ...expense,
    description: 'пересадка у вокзала',
    amountKopecks: 4300n,
  })
  assert.ok(first)
  assert.equal(first.categoryName, null)
  const expenses = await app.categories.listCategories(owner, 'expense')
  const transport = expenses.find(({ name }) => name === '🚇 Транспорт')
  const home = expenses.find(({ name }) => name === '🏠 Дом')
  assert.ok(transport && home)
  assert.equal(await app.categories.rememberCategory(owner, first.id, transport.id), false)
  assert.equal(await app.categories.setCategory(owner, first.id, transport.id), true)
  assert.equal(await app.categories.rememberCategory(other, first.id, transport.id), false)
  assert.equal(
    await app.categories.canRememberCategory(owner, 'expense', 'пересадка у вокзала'),
    true,
  )
  assert.equal(await app.categories.rememberCategory(owner, first.id, transport.id), true)
  assert.equal(await app.categories.rememberCategory(owner, first.id, transport.id), true)
  const [rule] = await app.categories.listCategoryRules(owner)
  assert.equal(rule.expression, 'пересадка у вокзала')
  assert.equal(rule.categoryId, transport.id)
  assert.equal(rule.categoryName, '🚇 Транспорт')
  assert.deepEqual(await app.categories.listCategoryRules(other), [])
  assert.equal(await app.categories.deleteCategoryRule(other, rule.id, transport.id), false)
  const next = await record(owner, {
    ...expense,
    description: '  ПЕРЕСАДКА У ВОКЗАЛА ',
    amountKopecks: 7500n,
  })
  assert.ok(next)
  assert.equal(next.categoryName, '🚇 Транспорт')
  assert.equal(
    (await record(other, { ...expense, description: 'пересадка у вокзала' }))?.categoryName,
    null,
  )
  assert.equal(
    (await record(owner, { ...income, description: 'пересадка у вокзала' }))?.categoryName,
    null,
  )
  const combined = await record(owner, { ...expense, description: 'пересадка у вокзала до дома' })
  assert.deepEqual(combined?.categoryChoices?.map(({ name }) => name).sort(), [
    '🏠 Дом',
    '🚇 Транспорт',
  ])

  assert.equal(await app.categories.setCategory(owner, next.id, home.id), true)
  assert.equal(await app.categories.rememberCategory(owner, next.id, transport.id), false)
  assert.equal(await app.categories.rememberCategory(owner, next.id, home.id), true)
  assert.equal(await app.categories.deleteCategoryRule(owner, rule.id, transport.id), false)
  assert.equal(await app.categories.renameCategory(owner, home.id, 'Поездки'), 'ok')
  assert.equal(
    (await record(owner, { ...expense, description: 'пересадка у вокзала' }))?.categoryName,
    'Поездки',
  )
  assert.equal(await app.categories.addCategory(owner, 'expense', 'Пересадка у вокзала'), 'ok')
  assert.equal(
    await app.categories.canRememberCategory(owner, 'expense', 'пересадка у вокзала'),
    false,
  )
  const exact = await record(owner, { ...expense, description: 'пересадка у вокзала' })
  assert.equal(exact?.categoryName, 'Пересадка у вокзала')
  const metro = (await app.categories.listCategories(owner, 'expense')).find(
    ({ name }) => name === 'Пересадка у вокзала',
  )
  assert.ok(metro)
  assert.equal(await app.categories.archiveCategory(owner, metro.id), true)
  assert.equal(await app.categories.archiveCategory(owner, home.id), true)
  assert.equal(await app.categories.rememberCategory(owner, next.id, home.id), false)
  assert.equal(
    (await record(owner, { ...expense, description: 'пересадка у вокзала' }))?.categoryName,
    null,
  )
  const [archivedRule] = await app.categories.listCategoryRules(owner)
  assert.equal(archivedRule.id, rule.id)
  assert.equal(archivedRule.categoryName, 'Поездки')
  assert.ok(archivedRule.archivedAt)
  assert.equal(await app.categories.deleteCategoryRule(owner, archivedRule.id, home.id), true)
  assert.equal(await app.categories.deleteCategoryRule(owner, archivedRule.id, home.id), false)
  assert.deepEqual(await app.categories.listCategoryRules(owner), [])
  assert.equal((await app.transactions.getOperation(owner, next.id))?.categoryName, 'Поездки')
  assert.equal(await app.categories.setCategory(owner, next.id, transport.id), true)
  assert.equal(await app.categories.rememberCategory(owner, next.id, transport.id), true)
  const [newRule] = await app.categories.listCategoryRules(owner)
  assert.notEqual(newRule.id, rule.id)
  assert.equal(await app.categories.deleteCategoryRule(owner, newRule.id, transport.id), true)
  assert.equal(
    (await record(owner, { ...expense, description: 'пересадка у вокзала' }))?.categoryName,
    null,
  )
  assert.equal((await app.transactions.getOperation(owner, next.id))?.categoryName, '🚇 Транспорт')
})

test('accounting preserves amounts, ownership and the idempotency key after deletion', async (t) => {
  const { db, app } = connect(t)
  const telegramId = randomInt(2 ** 40, 2 ** 41)
  const [ownerId, sameOwnerId, otherId] = await Promise.all([
    app.users.getOrCreateUser(telegramId),
    app.users.getOrCreateUser(telegramId),
    app.users.getOrCreateUser(telegramId + 1),
  ])
  assert.equal(ownerId, sameOwnerId)
  assert.notEqual(ownerId, otherId)

  const replayKey = `telegram:${randomUUID()}`
  const deliveries = await Promise.all(
    Array.from({ length: 8 }, () => app.transactions.recordOperation(ownerId, expense, replayKey)),
  )
  const recorded = deliveries.filter((result) => result.status === 'created')
  assert.equal(recorded.length, 1)
  assert.ok(deliveries.every(({ status }) => status === 'created' || status === 'duplicate'))
  assert.deepEqual(await app.transactions.recordOperation(ownerId, expense, replayKey), {
    status: 'duplicate',
  })
  const otherOperation = created(await app.transactions.recordOperation(otherId, income, replayKey))

  const ownerHistory = await app.transactions.recent(ownerId)
  const otherHistory = await app.transactions.recent(otherId)
  assert.equal(ownerHistory.length, 1)
  assert.equal(otherHistory.length, 1)
  const [entry] = ownerHistory
  const [otherEntry] = otherHistory
  assert.ok(entry)
  assert.ok(otherEntry)
  assert.equal(entry.id, recorded[0].id)
  assert.equal(entry.categoryName, '☕ Кафе')
  assert.equal(entry.kind, expense.kind)
  assert.equal(entry.amountKopecks, expense.amountKopecks)
  assert.equal(entry.description, expense.description)
  assert.equal(otherEntry.kind, income.kind)
  assert.equal(otherEntry.id, otherOperation.id)
  assert.equal(otherEntry.amountKopecks, income.amountKopecks)
  assert.equal(await app.transactions.remove(otherId, entry.id), false)
  assert.equal(await app.transactions.remove(ownerId, entry.id), true)
  assert.equal(await app.transactions.remove(ownerId, entry.id), false)
  assert.deepEqual(await app.transactions.recordOperation(ownerId, expense, replayKey), {
    status: 'duplicate',
  })
  assert.deepEqual(await app.transactions.recent(ownerId), [])
  assert.deepEqual(await app.transactions.recent(otherId), otherHistory)

  const stored = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.userId, ownerId), eq(transactions.idempotencyKey, replayKey)))
  assert.equal(stored.length, 1)
  assert.equal(stored[0]?.id, entry.id)
  assert.equal(stored[0]?.currency, 'RUB')
  assert.ok(stored[0]?.deletedAt)
})

test('concurrent first access seeds one catalogue without reviving archived defaults', async (t) => {
  const { app } = connect(t)
  const owner = await app.users.getOrCreateUser(randomInt(2 ** 40, 2 ** 41))
  const kinds = ['expense', 'income', 'income', 'expense', 'expense', 'income'] as const
  const lists = await Promise.all(kinds.map((kind) => app.categories.listCategories(owner, kind)))
  const [expenses, incomes] = lists
  assert.deepEqual(
    new Set(expenses.map(({ name }) => name)),
    new Set([
      '🛒 Продукты',
      '☕ Кафе',
      '🚇 Транспорт',
      '🏠 Дом',
      '🩺 Здоровье',
      '🛍️ Покупки',
      '✈️ Путешествия',
      '🔁 Подписки',
      '👕 Одежда и обувь',
      '💻 Техника',
      '💅 Красота и уход',
      '🎓 Образование',
      '🎁 Подарки',
    ]),
  )
  assert.deepEqual(
    new Set(incomes.map(({ name }) => name)),
    new Set(['💼 Зарплата', '🛠️ Проекты', '📈 Проценты']),
  )
  for (const [index, list] of lists.entries()) {
    assert.deepEqual(list, kinds[index] === 'expense' ? expenses : incomes)
  }

  for (const { id } of [...expenses, ...incomes]) {
    assert.equal(await app.categories.archiveCategory(owner, id), true)
  }
  assert.deepEqual(await app.categories.listCategories(owner, 'expense'), [])
  assert.deepEqual(await app.categories.listCategories(owner, 'income'), [])
})

test('catalogue normalizes concurrent duplicates within owner and kind', async (t) => {
  const { app, pool } = connect(t)
  const [owner, other] = await Promise.all([
    app.users.getOrCreateUser(randomInt(2 ** 40, 2 ** 41)),
    app.users.getOrCreateUser(randomInt(2 ** 40, 2 ** 41)),
  ])
  const results = await Promise.all(
    ['  Сад  ', 'САД', 'сад'].map((name) => app.categories.addCategory(owner, 'expense', name)),
  )
  assert.deepEqual(results.sort(), ['duplicate', 'duplicate', 'ok'])
  assert.equal(await app.categories.addCategory(owner, 'income', 'сад'), 'ok')
  assert.equal(await app.categories.addCategory(other, 'expense', 'сад'), 'ok')
  assert.equal(await app.categories.addCategory(owner, 'expense', '  '), 'invalid')
  assert.equal(await app.categories.addCategory(owner, 'expense', 'x'.repeat(61)), 'invalid')

  const list = await app.categories.listCategories(owner, 'expense')
  const garden = list.find(({ name }) => name.toLowerCase() === 'сад')
  const cafe = list.find(({ name }) => name === '☕ Кафе')
  assert.ok(garden)
  assert.ok(cafe)
  assert.equal(garden.name.trim(), garden.name)
  await assert.rejects(
    pool.query("INSERT INTO categories (user_id, kind, name) VALUES ($1, 'expense', '  сАд  ')", [
      owner,
    ]),
    { code: '23505' },
  )
  assert.equal(await app.categories.renameCategory(owner, cafe.id, ' сад '), 'duplicate')
  assert.equal(await app.categories.renameCategory(other, garden.id, 'Чужое имя'), 'unavailable')
  assert.equal(await app.categories.archiveCategory(other, garden.id), false)
  assert.equal(await app.categories.archiveCategory(owner, garden.id), true)
  assert.equal(await app.categories.archiveCategory(owner, garden.id), false)
  assert.equal(await app.categories.renameCategory(owner, garden.id, 'Архивное имя'), 'unavailable')
  assert.equal(await app.categories.addCategory(owner, 'expense', 'Сад'), 'ok')
  const reused = (await app.categories.listCategories(owner, 'expense')).find(
    ({ name }) => name === 'Сад',
  )
  assert.ok(reused)
  assert.notEqual(reused.id, garden.id)
})

test('only an active operation matches an active category of the same owner and kind', async (t) => {
  const { app, db, pool } = connect(t)
  const [owner, other] = await Promise.all([
    app.users.getOrCreateUser(randomInt(2 ** 40, 2 ** 41)),
    app.users.getOrCreateUser(randomInt(2 ** 40, 2 ** 41)),
  ])
  const [operationId, ownerExpenses, [ownerIncome], [otherExpense]] = await Promise.all([
    insertOperation(db, owner, expense, `telegram:${randomUUID()}`),
    app.categories.listCategories(owner, 'expense'),
    app.categories.listCategories(owner, 'income'),
    app.categories.listCategories(other, 'expense'),
  ])
  assert.ok(operationId)
  const [first, second] = ownerExpenses
  assert.equal(await app.transactions.getOperationKind(owner, operationId), 'expense')
  assert.equal(await app.transactions.getOperationKind(other, operationId), null)
  for (const invalid of [ownerIncome.id, otherExpense.id]) {
    await assert.rejects(
      pool.query('UPDATE transactions SET category_id = $1 WHERE id = $2', [invalid, operationId]),
      { code: '23503' },
    )
    assert.equal(await app.categories.setCategory(owner, operationId, invalid), false)
  }
  assert.equal(await app.categories.setCategory(other, operationId, otherExpense.id), false)
  assert.equal((await app.transactions.recent(owner))[0]?.categoryName, null)
  assert.equal(await app.categories.setCategory(owner, operationId, first.id), true)
  assert.equal((await app.transactions.recent(owner))[0]?.categoryName, first.name)
  assert.equal(await app.categories.setCategory(owner, operationId, second.id), true)
  assert.equal(await app.categories.renameCategory(owner, second.id, ' Новое имя '), 'ok')
  assert.equal((await app.transactions.recent(owner))[0]?.categoryName, 'Новое имя')
  assert.equal(await app.categories.archiveCategory(owner, second.id), true)
  assert.equal((await app.transactions.recent(owner))[0]?.categoryName, 'Новое имя')
  assert.ok(
    !(await app.categories.listCategories(owner, 'expense')).some(({ id }) => id === second.id),
  )
  assert.equal(await app.categories.setCategory(owner, operationId, null), true)
  assert.equal(await app.categories.setCategory(owner, operationId, second.id), false)
  assert.equal((await app.transactions.recent(owner))[0]?.categoryName, null)
  assert.equal(await app.transactions.remove(owner, operationId), true)
  assert.equal(await app.transactions.getOperationKind(owner, operationId), null)
  assert.equal(await app.categories.setCategory(owner, operationId, first.id), false)
})

test('assignment waits for an in-flight archive and then rejects the archived category', async (t) => {
  const { app, db, pool } = connect(t)
  const owner = await app.users.getOrCreateUser(randomInt(2 ** 40, 2 ** 41))
  const operationId = await insertOperation(db, owner, expense, `telegram:${randomUUID()}`)
  assert.ok(operationId)
  const [{ id: categoryId }] = await app.categories.listCategories(owner, 'expense')
  const assignmentUrl = new URL(process.env.DATABASE_URL!)
  const appName = `financebro-assignment-${randomUUID()}`
  assignmentUrl.searchParams.set('application_name', appName)
  const { app: assigning } = connect(t, assignmentUrl.href)
  const client = await pool.connect()

  let assignment: Promise<boolean> | undefined
  try {
    await client.query('BEGIN')
    await client.query('UPDATE categories SET archived_at = now() WHERE id = $1', [categoryId])
    assignment = assigning.categories.setCategory(owner, operationId, categoryId)
    const deadline = Date.now() + 3_000
    let blocked = false
    while (!blocked && Date.now() < deadline) {
      const result = await pool.query(
        "SELECT 1 FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'",
        [appName],
      )
      blocked = result.rowCount === 1
      if (!blocked) await delay(20)
    }
    assert.equal(blocked, true, 'assignment must wait for the archiving row lock')
    await client.query('COMMIT')
    assert.equal(await assignment, false)
    assert.equal((await app.transactions.recent(owner))[0]?.categoryName, null)
  } finally {
    await client.query('ROLLBACK')
    client.release()
    await assignment?.catch(() => {})
  }
})

test('built-in words use a personal override, can be disabled and follow the starter category', async (t) => {
  const { app } = connect(t)
  const telegramId = randomInt(2 ** 40, 2 ** 41)
  const owner = await app.users.getOrCreateUser(telegramId)
  const other = await app.users.getOrCreateUser(telegramId + 1)
  const record = async (
    description: string,
    userId = owner,
    kind: 'expense' | 'income' = 'expense',
  ) =>
    created(
      await app.transactions.recordOperation(
        userId,
        { kind, description, amountKopecks: 100n },
        randomUUID(),
      ),
    )

  for (const description of ['  ХАТА ', 'квартира', 'за квартиру', 'съем квартиры']) {
    assert.equal((await record(description))?.categoryName, '🏠 Дом', description)
  }
  assert.equal((await record('подарок'))?.categoryName, '🎁 Подарки')
  assert.equal((await record('подарок', owner, 'income'))?.categoryName, null)
  assert.equal((await record('аренда   квартиры'))?.categoryName, '🏠 Дом')
  assert.equal((await record('мебель для хаты'))?.categoryName, '🏠 Дом')
  assert.equal((await record('хата', owner, 'income'))?.categoryName, null)
  assert.deepEqual(await app.categories.listCategoryRules(owner), [])

  const home = (await app.categories.listBuiltInTargets(owner, 'expense')).find(
    ({ key }) => key === 'housing',
  )
  assert.ok(home)
  assert.equal(await app.categories.renameCategory(owner, home.id, 'Жильё'), 'ok')
  assert.equal((await record('хата'))?.categoryName, 'Жильё')
  assert.equal(await app.categories.addCategory(owner, 'expense', 'Аренда'), 'ok')
  const rent = (await app.categories.listCategories(owner, 'expense')).find(
    ({ name }) => name === 'Аренда',
  )
  assert.ok(rent)

  const operation = await record('хата')
  assert.ok(operation)
  assert.equal(await app.categories.setCategory(owner, operation.id, rent.id), true)
  assert.equal(await app.categories.rememberCategory(owner, operation.id, rent.id), true)
  assert.equal((await record('ХАТА'))?.categoryName, 'Аренда')
  assert.equal((await record('хата', other))?.categoryName, '🏠 Дом')
  assert.equal(await app.categories.changeBuiltInRule(other, 'expense', 'хата', rent.id), false)
  assert.equal(await app.categories.changeBuiltInRule(owner, 'income', 'хата', null), false)
  assert.equal(await app.categories.changeBuiltInRule(owner, 'expense', 'хата', null), true)
  assert.equal((await record('хата'))?.categoryName, null)
  const disabled = await app.categories.getBuiltInRule(owner, 'expense', 'ХАТА')
  assert.ok(disabled)
  assert.equal(disabled.categoryId, null)
  assert.equal(await app.categories.deleteCategoryRule(owner, disabled.id, null), true)
  assert.equal((await record('хата'))?.categoryName, 'Жильё')
  assert.equal((await app.transactions.getOperation(owner, operation.id))?.categoryName, 'Аренда')

  assert.equal(await app.categories.archiveCategory(owner, home.id), true)
  assert.equal((await record('хата'))?.categoryName, null)
  assert.equal(await app.categories.bindBuiltInGroup(owner, 'expense', 'housing', rent.id), true)
  assert.equal((await record('хата'))?.categoryName, 'Аренда')
  assert.equal((await record('коммуналка'))?.categoryName, 'Аренда')
})

test('dated writes and edits update local history and monthly budgets without changing creation time', async (t) => {
  const { app, pool } = connect(t)
  const telegramId = randomInt(2 ** 40, 2 ** 41)
  const owner = await app.users.getOrCreateUser(telegramId)
  const other = await app.users.getOrCreateUser(telegramId + 1)
  const timeZone = 'Asia/Yekaterinburg'
  await pool.query('UPDATE users SET time_zone = $1 WHERE id = $2', [timeZone, owner])
  const input = { ...expense, operationDate: { date: '2026-10-31', timeZone } }
  const receipt = created(await app.transactions.recordOperation(owner, input, 'telegram:dated'))
  assert.deepEqual(await app.transactions.recordOperation(owner, input, 'telegram:dated'), {
    status: 'duplicate',
  })
  const original = await app.transactions.getOperation(owner, receipt.id)
  assert.ok(original)
  assert.deepEqual(original.operationDate, input.operationDate)
  assert.equal((await app.transactions.dailyHistory(owner, '2026-10-31', timeZone)).length, 1)
  assert.equal(
    (await app.budgets.monthlyBudget(owner, '2026-10-01', timeZone)).totalSpent,
    expense.amountKopecks,
  )

  const updatedDate = { date: '2026-11-01', timeZone }
  assert.equal(await app.transactions.setOperationDate(other, receipt.id, updatedDate), false)
  assert.equal(await app.transactions.setOperationDate(owner, receipt.id, updatedDate), true)
  const updated = await app.transactions.getOperation(owner, receipt.id)
  assert.deepEqual(updated, { ...original, operationDate: updatedDate })
  assert.deepEqual(await app.transactions.dailyHistory(owner, '2026-10-31', timeZone), [])
  assert.equal(
    (await app.transactions.dailyHistory(owner, '2026-11-01', timeZone))[0]?.id,
    receipt.id,
  )
  assert.equal((await app.budgets.monthlyBudget(owner, '2026-10-01', timeZone)).totalSpent, 0n)
  assert.equal(
    (await app.budgets.monthlyBudget(owner, '2026-11-01', timeZone)).totalSpent,
    expense.amountKopecks,
  )

  assert.equal(await app.transactions.remove(owner, receipt.id), true)
  assert.equal(
    await app.transactions.setOperationDate(owner, receipt.id, input.operationDate),
    false,
  )
})
