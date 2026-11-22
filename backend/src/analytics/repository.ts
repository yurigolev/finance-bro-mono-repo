import { and, eq, isNull, sql } from 'drizzle-orm'
import type { Database } from '../db/client.ts'
import { categories, transactions } from '../db/schema.ts'
import { adjacentDay } from '../shared/calendar.ts'
import type { OperationKind } from '../transactions/types.ts'

type PeriodRows = {
  dailyRows: {
    date: string
    incomeKopecks: string
    expenseKopecks: string
    operationCount: string
  }[]
  categoryRows: {
    date: string | null
    kind: OperationKind
    id: string | null
    name: string | null
    amountKopecks: string
  }[]
}

export async function readAnalyticsPeriod(
  connection: Pick<Database, 'select'>,
  userId: string,
  startDate: string,
  endDate: string,
  timeZone: string,
): Promise<PeriodRows> {
  const localDate = sql`(${transactions.occurredAt} AT TIME ZONE ${timeZone})::date`
  const day = sql<string>`to_char(${localDate}, 'YYYY-MM-DD')`.as('local_day')
  const periodStart = sql`${startDate}::date`
  const periodEnd = sql`${adjacentDay(endDate, 1)}::date`
  const filter = and(
    eq(transactions.userId, userId),
    isNull(transactions.deletedAt),
    // Bound the index scan, then match local dates even when midnight repeats or is skipped.
    sql`${transactions.occurredAt} >= (${periodStart}::timestamp AT TIME ZONE 'UTC') - interval '24 hours'`,
    sql`${transactions.occurredAt} < (${periodEnd}::timestamp AT TIME ZONE 'UTC') + interval '24 hours'`,
    sql`${localDate} >= ${periodStart} AND ${localDate} < ${periodEnd}`,
  )
  const dailyRows = await connection
    .select({
      date: day,
      incomeKopecks: sql<string>`coalesce(sum(${transactions.amountKopecks}) filter (where ${transactions.kind} = 'income'), 0)::text`,
      expenseKopecks: sql<string>`coalesce(sum(${transactions.amountKopecks}) filter (where ${transactions.kind} = 'expense'), 0)::text`,
      operationCount: sql<string>`count(*)::text`,
    })
    .from(transactions)
    .where(filter)
    .groupBy(day)
  const categoryRows = await connection
    .select({
      date: sql<string | null>`to_char(${localDate}, 'YYYY-MM-DD')`.as('local_day'),
      kind: transactions.kind,
      id: transactions.categoryId,
      name: categories.name,
      amountKopecks: sql<string>`sum(${transactions.amountKopecks})::text`,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(filter)
    .groupBy(
      sql`${transactions.kind}, ${transactions.categoryId}, ${categories.name}, grouping sets ((local_day), ())`,
    )

  return { dailyRows, categoryRows }
}
