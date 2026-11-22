import { and, desc, eq, isNotNull, isNull, lte, or, sql } from 'drizzle-orm'
import type { Database } from '../db/client.ts'
import { budgetLimitVersions, categories, transactions } from '../db/schema.ts'
import type { MonthlyBudget } from './types.ts'

export async function readMonthlyBudget(
  db: Pick<Database, 'select' | 'selectDistinctOn'>,
  userId: string,
  month: string,
  timeZone: string,
): Promise<MonthlyBudget> {
  const limits = budgetLimitVersions
  const effectiveLimits = db
    .selectDistinctOn([limits.categoryId], {
      categoryId: limits.categoryId,
      amountKopecks: limits.amountKopecks,
    })
    .from(limits)
    .where(and(eq(limits.userId, userId), lte(limits.effectiveMonth, month)))
    .orderBy(limits.categoryId, desc(limits.effectiveMonth))
    .as('effective_limits')
  const monthStart = sql`${month}::date`
  const nextMonth = sql`(${monthStart} + interval '1 month')`
  const localDate = sql`(${transactions.occurredAt} AT TIME ZONE ${timeZone})::date`
  const [versions, expenses] = await Promise.all([
    db
      .select({
        categoryId: effectiveLimits.categoryId,
        amountKopecks: effectiveLimits.amountKopecks,
        name: categories.name,
        archived: sql<boolean>`${categories.archivedAt} IS NOT NULL`,
      })
      .from(effectiveLimits)
      .leftJoin(categories, eq(effectiveLimits.categoryId, categories.id))
      .where(
        and(
          isNotNull(effectiveLimits.amountKopecks),
          or(
            isNull(categories.archivedAt),
            sql`(${categories.archivedAt} AT TIME ZONE ${timeZone})::date >= ${monthStart}`,
          ),
        ),
      )
      .orderBy(categories.name, effectiveLimits.categoryId),
    db
      .select({
        categoryId: transactions.categoryId,
        spent: sql<string>`sum(${transactions.amountKopecks})`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.kind, 'expense'),
          isNull(transactions.deletedAt),
          // Bound the index scan, then match the local month even when midnight repeats or is skipped.
          sql`${transactions.occurredAt} >= (${monthStart}::timestamp AT TIME ZONE 'UTC') - interval '24 hours'`,
          sql`${transactions.occurredAt} < (${nextMonth} AT TIME ZONE 'UTC') + interval '24 hours'`,
          sql`${localDate} >= ${monthStart} AND ${localDate} < ${nextMonth}`,
        ),
      )
      .groupBy(transactions.categoryId),
  ])

  const spentByCategory = new Map(
    expenses.map(({ categoryId, spent }) => [categoryId, BigInt(spent)]),
  )
  return {
    totalSpent: [...spentByCategory.values()].reduce((total, spent) => total + spent, 0n),
    totalLimit: versions.find(({ categoryId }) => categoryId === null)?.amountKopecks ?? null,
    categories: versions.flatMap(({ categoryId, amountKopecks, name, archived }) =>
      categoryId !== null && amountKopecks !== null && name !== null
        ? [
            {
              id: categoryId,
              name,
              archived,
              limit: amountKopecks,
              spent: spentByCategory.get(categoryId) ?? 0n,
            },
          ]
        : [],
    ),
  }
}

export async function lockExpenseBudgetCategory(
  connection: Pick<Database, 'select'>,
  userId: string,
  categoryId: string,
): Promise<boolean> {
  // Archive updates the same category row.
  const [category] = await connection
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(
        eq(categories.userId, userId),
        eq(categories.id, categoryId),
        isNull(categories.archivedAt),
        eq(categories.kind, 'expense'),
      ),
    )
    .for('update')
  return Boolean(category)
}

export async function upsertMonthlyBudgetLimit(
  connection: Pick<Database, 'insert'>,
  userId: string,
  month: string,
  categoryId: string | null,
  amountKopecks: bigint | null,
): Promise<void> {
  const limits = budgetLimitVersions
  await connection
    .insert(limits)
    .values({ userId, categoryId, effectiveMonth: month, amountKopecks })
    .onConflictDoUpdate({
      target:
        categoryId === null
          ? [limits.userId, limits.effectiveMonth]
          : [limits.userId, limits.categoryId, limits.effectiveMonth],
      targetWhere: categoryId === null ? isNull(limits.categoryId) : isNotNull(limits.categoryId),
      set: { amountKopecks },
    })
}
