import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

export const transactionKind = pgEnum('transaction_kind', ['expense', 'income'])

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  telegramId: bigint('telegram_id', { mode: 'number' }).notNull().unique(),
  timeZone: text('time_zone'),
})

export const activeCategoryNameIndex = 'categories_active_name_idx'

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    kind: transactionKind('kind').notNull(),
    name: text('name').notNull(),
    starterKey: text('starter_key'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => [
    unique('categories_user_kind_id').on(table.userId, table.kind, table.id),
    unique('categories_user_kind_starter_key').on(table.userId, table.kind, table.starterKey),
    uniqueIndex(activeCategoryNameIndex)
      .on(table.userId, table.kind, sql`lower(btrim(${table.name}))`)
      .where(sql`${table.archivedAt} IS NULL`),
    check('categories_name_length', sql`char_length(btrim(${table.name})) BETWEEN 1 AND 60`),
  ],
)

export const categoryRules = pgTable(
  'category_rules',
  {
    id: uuid('id').notNull().defaultRandom().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    kind: transactionKind('kind').notNull(),
    expression: text('expression').notNull(),
    categoryId: uuid('category_id'),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.kind, table.expression] }),
    foreignKey({
      columns: [table.userId, table.kind, table.categoryId],
      foreignColumns: [categories.userId, categories.kind, categories.id],
      name: 'category_rules_user_kind_category_fk',
    }),
    check(
      'category_rules_expression_length',
      sql`char_length(${table.expression}) BETWEEN 1 AND 200`,
    ),
  ],
)

export const budgetLimitVersions = pgTable(
  'budget_limit_versions',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    categoryId: uuid('category_id'),
    kind: transactionKind('kind').notNull().default('expense'),
    effectiveMonth: date('effective_month').notNull(),
    amountKopecks: bigint('amount_kopecks', { mode: 'bigint' }),
  },
  (table) => [
    foreignKey({
      columns: [table.userId, table.kind, table.categoryId],
      foreignColumns: [categories.userId, categories.kind, categories.id],
      name: 'budget_limit_versions_user_kind_category_fk',
    }),
    check('budget_limit_versions_expense', sql`${table.kind} = 'expense'`),
    check('budget_limit_versions_month_start', sql`extract(day from ${table.effectiveMonth}) = 1`),
    check('budget_limit_versions_positive_amount', sql`${table.amountKopecks} > 0`),
    uniqueIndex('budget_limit_versions_total_idx')
      .on(table.userId, table.effectiveMonth)
      .where(sql`${table.categoryId} IS NULL`),
    uniqueIndex('budget_limit_versions_category_idx')
      .on(table.userId, table.categoryId, table.effectiveMonth)
      .where(sql`${table.categoryId} IS NOT NULL`),
  ],
)

export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    kind: transactionKind('kind').notNull(),
    amountKopecks: bigint('amount_kopecks', { mode: 'bigint' }).notNull(),
    currency: text('currency').notNull().default('RUB'),
    description: text('description').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    idempotencyKey: text('idempotency_key').notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    categoryId: uuid('category_id'),
  },
  (table) => [
    foreignKey({
      columns: [table.userId, table.kind, table.categoryId],
      foreignColumns: [categories.userId, categories.kind, categories.id],
      name: 'transactions_user_kind_category_fk',
    }),
    check('transactions_positive_amount', sql`${table.amountKopecks} > 0`),
    check('transactions_rub_currency', sql`${table.currency} = 'RUB'`),
    check('transactions_nonempty_description', sql`btrim(${table.description}) <> ''`),
    unique('transactions_user_idempotency_key').on(table.userId, table.idempotencyKey),
    index('transactions_user_recent_idx')
      .on(table.userId, table.createdAt.desc(), table.id.desc())
      .where(sql`${table.deletedAt} IS NULL`),
    index('transactions_user_daily_idx')
      .on(table.userId, table.occurredAt.desc(), table.id.desc())
      .where(sql`${table.deletedAt} IS NULL`),
  ],
)
