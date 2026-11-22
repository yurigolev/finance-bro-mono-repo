import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { createApplication } from '../src/app.ts'
import { createDatabase } from '../src/db/client.ts'
import { insertOperation } from '../src/transactions/repository.ts'

const migrationsFolder = fileURLToPath(new URL('../drizzle/', import.meta.url))
const migrationDatabaseUrl = process.env.MIGRATION_TEST_DATABASE_URL
const skip =
  !migrationDatabaseUrl &&
  'MIGRATION_TEST_DATABASE_URL must point to a test server with CREATEDB rights'

async function createTestDatabase(t: TestContext) {
  assert.ok(migrationDatabaseUrl)
  const name = `financebro_test_${randomUUID().replaceAll('-', '')}`
  const url = new URL(migrationDatabaseUrl)
  url.pathname = `/${name}`
  const database = createDatabase(url.href)
  const { pool: admin } = createDatabase(migrationDatabaseUrl)
  let created = false
  t.after(async () => {
    try {
      await database.pool.end()
      if (created) await admin.query(`DROP DATABASE "${name}"`)
    } finally {
      await admin.end()
    }
  })

  await admin.query(`CREATE DATABASE "${name}"`)
  created = true
  return database
}

test('Drizzle installs all migrations on a clean PostgreSQL database', { skip }, async (t) => {
  const { db, pool } = await createTestDatabase(t)
  await migrate(db, { migrationsFolder })
  const app = createApplication(db).telegram
  const owner = await app.users.getOrCreateUser(123)
  const id = await insertOperation(
    db,
    owner,
    { kind: 'expense', amountKopecks: 48_000n, description: 'кофе' },
    'telegram:1',
  )
  assert.ok(id)
  const {
    rows: [saved],
  } = await pool.query('SELECT created_at, occurred_at FROM transactions WHERE id = $1', [id])
  assert.ok(saved.occurred_at instanceof Date)
  assert.deepEqual(saved.occurred_at, saved.created_at)
  assert.equal((await app.transactions.recent(owner))[0]?.categoryName, null)
  assert.equal((await pool.query('SELECT id FROM categories')).rowCount, 0)
  const category = (await app.categories.listCategories(owner, 'expense')).find(
    ({ name }) => name === '☕ Кафе',
  )
  assert.ok(category)
  assert.equal(await app.categories.setCategory(owner, id, category.id), true)
  assert.equal((await app.transactions.recent(owner))[0]?.categoryName, '☕ Кафе')
})

async function migrationPrefix(t: TestContext, lastTag: string) {
  const initialFolder = await mkdtemp(join(tmpdir(), 'financebro-initial-migration-'))
  t.after(() => rm(initialFolder, { recursive: true, force: true }))
  const journal = JSON.parse(
    await readFile(join(migrationsFolder, 'meta', '_journal.json'), 'utf8'),
  )
  const lastIndex = journal.entries.findIndex(({ tag }: { tag: string }) => tag === lastTag)
  assert.ok(lastIndex >= 0)
  const entries = journal.entries.slice(0, lastIndex + 1)
  await mkdir(join(initialFolder, 'meta'))
  await writeFile(
    join(initialFolder, 'meta', '_journal.json'),
    JSON.stringify({ ...journal, entries }),
  )
  await Promise.all(
    entries.map(({ tag }: { tag: string }) =>
      copyFile(join(migrationsFolder, `${tag}.sql`), join(initialFolder, `${tag}.sql`)),
    ),
  )
  return initialFolder
}

test('budget migration preserves operations and constrains monthly limits', { skip }, async (t) => {
  const { db, pool } = await createTestDatabase(t)
  await migrate(db, {
    migrationsFolder: await migrationPrefix(t, '0007_expand_expense_categories'),
  })
  const app = createApplication(db).telegram
  const owner = await app.users.getOrCreateUser(501)
  const other = await app.users.getOrCreateUser(502)
  const [category] = await app.categories.listCategories(owner, 'expense')
  const [incomeCategory] = await app.categories.listCategories(owner, 'income')
  await insertOperation(
    db,
    owner,
    { kind: 'expense', amountKopecks: 12_300n, description: 'чай' },
    'telegram:12',
  )
  const before = await app.transactions.recent(owner)
  await migrate(db, { migrationsFolder })
  assert.deepEqual(await app.transactions.recent(owner), before)

  const insert = (
    user: string,
    categoryId: string | null,
    date = '2025-11-01',
    amount = 100,
    kind = 'expense',
  ) =>
    pool.query(
      `INSERT INTO budget_limit_versions (user_id, category_id, effective_month, amount_kopecks, kind)
      VALUES ($1, $2, $3, $4, $5)`,
      [user, categoryId, date, amount, kind],
    )
  await insert(owner, null)
  await insert(owner, category.id)
  await insert(other, null)
  await assert.rejects(insert(owner, null), {
    code: '23505',
    constraint: 'budget_limit_versions_total_idx',
  })
  await assert.rejects(insert(owner, category.id), {
    code: '23505',
    constraint: 'budget_limit_versions_category_idx',
  })
  await assert.rejects(insert(other, category.id), { code: '23503' })
  await assert.rejects(insert(owner, incomeCategory.id), { code: '23503' })
  await assert.rejects(insert(owner, incomeCategory.id, '2025-11-01', 100, 'income'), {
    code: '23514',
  })
  await assert.rejects(insert(owner, null, '2025-11-02'), { code: '23514' })
  await assert.rejects(insert(owner, null, '2025-12-01', 0), { code: '23514' })
})

test(
  'Drizzle upgrades the first schema without changing active or deleted operations',
  { skip },
  async (t) => {
    const { db, pool } = await createTestDatabase(t)
    await migrate(db, { migrationsFolder: await migrationPrefix(t, '0000_initial') })

    const {
      rows: [user],
    } = await pool.query<{ id: string }>(
      'INSERT INTO users (telegram_id) VALUES (789) RETURNING id',
    )
    await pool.query(
      `INSERT INTO transactions (user_id, kind, amount_kopecks, description, created_at, idempotency_key, deleted_at)
    VALUES ($1, 'expense', 48050, 'кофе', '2025-05-04T03:02:01Z', 'telegram:7', NULL),
           ($1, 'income', 9223372036854775807, 'проект', '2025-05-05T03:02:01Z', 'telegram:8', '2025-05-06T03:02:01Z')`,
      [user.id],
    )
    const { rows: before } = await pool.query('SELECT * FROM transactions ORDER BY idempotency_key')
    const { rows: migrationsBefore } = await pool.query(
      'SELECT * FROM drizzle.__drizzle_migrations ORDER BY id',
    )
    assert.equal(migrationsBefore.length, 1)
    assert.equal(before.length, 2)

    await migrate(db, { migrationsFolder })
    const { rows: after } = await pool.query('SELECT * FROM transactions ORDER BY idempotency_key')
    assert.deepEqual(
      after,
      before.map((row) => ({ ...row, category_id: null, occurred_at: row.created_at })),
    )
    const { rows: migrationsAfter } = await pool.query(
      'SELECT * FROM drizzle.__drizzle_migrations ORDER BY id',
    )
    assert.ok(migrationsAfter.length > 1)
    assert.deepEqual(migrationsAfter[0], migrationsBefore[0])

    const app = createApplication(db).telegram
    const history = await app.transactions.recent(user.id)
    assert.equal(history.length, 1)
    assert.equal(history[0].id, before[0].id)
    assert.equal(history[0].amountKopecks, 48_050n)
    assert.equal(history[0].categoryName, null)
    const daily = await app.transactions.dailyHistory(user.id, '2025-05-04', 'UTC')
    assert.deepEqual(daily, history)
    assert.deepEqual(
      await app.transactions.recordOperation(
        user.id,
        { kind: 'income', amountKopecks: 1n, description: 'повтор' },
        'telegram:8',
      ),
      { status: 'duplicate' },
    )
    const { rows: afterReplay } = await pool.query(
      'SELECT * FROM transactions ORDER BY idempotency_key',
    )
    assert.deepEqual(afterReplay, after)
  },
)

test(
  'existing remembered words get distinct IDs while preserving their mappings',
  { skip },
  async (t) => {
    const { db, pool } = await createTestDatabase(t)
    await migrate(db, { migrationsFolder: await migrationPrefix(t, '0002_category_rules') })
    const app = createApplication(db).telegram
    const {
      rows: [{ id: owner }],
    } = await pool.query<{ id: string }>(
      'INSERT INTO users (telegram_id) VALUES (987) RETURNING id',
    )
    const {
      rows: [category],
    } = await pool.query<{ id: string }>(
      "INSERT INTO categories (user_id, kind, name) VALUES ($1, 'expense', 'Транспорт') RETURNING id",
      [owner],
    )
    await pool.query(
      "INSERT INTO category_rules (user_id, kind, expression, category_id) VALUES ($1, 'expense', 'метро', $2), ($1, 'expense', 'такси', $2)",
      [owner, category.id],
    )
    await migrate(db, { migrationsFolder })

    const rules = await app.categories.listCategoryRules(owner)
    assert.equal(rules.length, 2)
    assert.equal(new Set(rules.map(({ id }) => id)).size, 2)
    assert.deepEqual(
      new Set(rules.map(({ expression }) => expression)),
      new Set(['метро', 'такси']),
    )
    assert.ok(rules.every(({ categoryId }) => categoryId === category.id))
    assert.equal(await app.categories.deleteCategoryRule(owner, rules[0].id, category.id), true)
    assert.deepEqual(await app.categories.listCategoryRules(owner), [rules[1]])
  },
)

test(
  'emoji migration preserves category IDs, history, archived rows and custom names',
  { skip },
  async (t) => {
    const { db, pool } = await createTestDatabase(t)
    await migrate(db, { migrationsFolder: await migrationPrefix(t, '0004_daily_history') })
    const app = createApplication(db).telegram
    const owner = await app.users.getOrCreateUser(456)
    const {
      rows: [{ id: transport }],
    } = await pool.query<{ id: string }>(
      `
    INSERT INTO categories (user_id, kind, name, archived_at) VALUES
      ($1, 'expense', 'Транспорт', NULL), ($1, 'expense', 'Дом', now()),
      ($1, 'expense', 'Кафе', NULL), ($1, 'expense', '☕ КАФЕ', NULL),
      ($1, 'expense', 'Такси', NULL)
    RETURNING id`,
      [owner],
    )
    const operation = await insertOperation(
      db,
      owner,
      { kind: 'expense', amountKopecks: 7500n, description: 'метро' },
      'telegram:9',
    )
    assert.ok(operation)
    assert.equal(await app.categories.setCategory(owner, operation, transport), true)
    await pool.query(
      "INSERT INTO category_rules (user_id, kind, expression, category_id) VALUES ($1, 'expense', 'метро', $2)",
      [owner, transport],
    )
    const { rows: before } = await pool.query('SELECT * FROM categories ORDER BY id')

    await migrate(db, { migrationsFolder })
    const { rows: after } = await pool.query('SELECT * FROM categories ORDER BY id')
    const newNames = new Map([
      ['Транспорт', '🚇 Транспорт'],
      ['Дом', '🏠 Дом'],
    ])
    const previousIds = new Set(before.map(({ id }) => id))
    assert.deepEqual(
      after.filter(({ id }) => previousIds.has(id)),
      before.map((row) => ({
        ...row,
        name: newNames.get(row.name) ?? row.name,
        starter_key:
          row.name === 'Транспорт' ? 'transport' : row.name === '☕ КАФЕ' ? 'dining' : null,
      })),
    )
    assert.equal(
      (await app.transactions.getOperation(owner, operation))?.categoryName,
      '🚇 Транспорт',
    )
    const [rule] = await app.categories.listCategoryRules(owner)
    assert.equal(rule.categoryId, transport)
    assert.equal(rule.categoryName, '🚇 Транспорт')
  },
)

test(
  'expense category expansion adopts a personal category and classifies new expenses after upgrade',
  { skip },
  async (t) => {
    const { db, pool } = await createTestDatabase(t)
    await migrate(db, { migrationsFolder: await migrationPrefix(t, '0006_builtin_category_words') })
    const app = createApplication(db).telegram
    const owner = await app.users.getOrCreateUser(321)
    const {
      rows: [personal],
    } = await pool.query<{ id: string }>(
      `INSERT INTO categories (user_id, kind, name) VALUES ($1, 'expense', 'Техника') RETURNING id`,
      [owner],
    )

    await migrate(db, { migrationsFolder })
    const catalogue = await app.categories.listCategories(owner, 'expense')
    assert.equal(catalogue.length, 7)
    assert.equal(catalogue.find(({ name }) => name === 'Техника')?.id, personal.id)

    const examples = [
      ['авиабилет', '✈️ Путешествия'],
      ['домашний интернет', '🔁 Подписки'],
      ['куртка', '👕 Одежда и обувь'],
      ['ноутбук', 'Техника'],
      ['стрижка', '💅 Красота и уход'],
      ['репетитор', '🎓 Образование'],
    ]
    for (const [description, category] of examples) {
      const operation = await app.transactions.recordOperation(
        owner,
        { kind: 'expense', description, amountKopecks: 100n },
        description,
      )
      assert.equal(operation.status, 'created', description)
      assert.equal(operation.categoryName, category, description)
    }
  },
)

test(
  'gift migration preserves old income and gives new gifts an expense category',
  { skip },
  async (t) => {
    const { db, pool } = await createTestDatabase(t)
    await migrate(db, { migrationsFolder: await migrationPrefix(t, '0008_monthly_budgets') })
    const app = createApplication(db).telegram
    const owner = await app.users.getOrCreateUser(765)
    const other = await app.users.getOrCreateUser(766)
    const {
      rows: [oldGift, expenseGift, renamed],
    } = await pool.query<{ id: string }>(
      `
    INSERT INTO categories (user_id, kind, name, starter_key) VALUES
      ($1, 'income', '🎁 Подарки', 'gifts'), ($1, 'expense', 'Подарки', NULL),
      ($2, 'income', 'Семейные переводы', 'gifts')
    RETURNING id`,
      [owner, other],
    )
    const oldOperation = await insertOperation(
      db,
      owner,
      { kind: 'income', description: 'подарок', amountKopecks: 100n },
      'telegram:1',
    )
    assert.ok(oldOperation)
    assert.equal(await app.categories.setCategory(owner, oldOperation, oldGift.id), true)

    await migrate(db, { migrationsFolder })

    const history = await app.transactions.getOperation(owner, oldOperation)
    assert.equal(history?.kind, 'income')
    assert.equal(history.categoryName, '🎁 Подарки')
    assert.deepEqual(await app.categories.listCategories(owner, 'income'), [])
    assert.deepEqual(await app.categories.listCategories(owner, 'expense'), [
      { id: expenseGift.id, name: 'Подарки' },
    ])
    assert.deepEqual(await app.categories.listCategories(other, 'income'), [
      { id: renamed.id, name: 'Семейные переводы' },
    ])
    const saved = await app.transactions.recordOperation(
      owner,
      { description: 'подарок', amountKopecks: 100n },
      'telegram:2',
    )
    assert.equal(saved.status, 'created')
    assert.equal(saved.kind, 'expense')
    assert.equal(saved.categoryName, 'Подарки')
  },
)
