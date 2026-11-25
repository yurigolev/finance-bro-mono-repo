import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import type { Database } from '../db/client.ts'
import { categories, transactions } from '../db/schema.ts'
import type {
  OperationDate,
  OperationDetails,
  OperationInput,
  OperationKind,
  OperationSummary,
} from '../../../packages/contracts/transactions.ts'

export function activeOperation(userId: string, id: string) {
  return and(
    eq(transactions.userId, userId),
    eq(transactions.id, id),
    isNull(transactions.deletedAt),
  )
}

// Put date-only entries at local noon so the selected day drives history and budgets.
function occurredOn({ date, timeZone }: OperationDate) {
  const localNoon = sql`(${date}::date + time '12:00')`
  const instant = sql`(${localNoon} AT TIME ZONE ${timeZone})`
  // A historical time-zone transition can skip an entire calendar day.
  return sql`CASE WHEN (${instant} AT TIME ZONE ${timeZone})::date = ${date}::date THEN ${instant} END`
}

export async function operationDateExists(
  connection: Pick<Database, 'execute'>,
  date: OperationDate,
) {
  const result = await connection.execute<{ exists: boolean }>(
    sql`select ${occurredOn(date)} is not null as "exists"`,
  )
  return result.rows[0]?.exists === true
}

export async function insertOperation(
  connection: Pick<Database, 'insert'>,
  userId: string,
  input: OperationInput,
  idempotencyKey: string,
  categoryId?: string,
): Promise<string | null> {
  const [inserted] = await connection
    .insert(transactions)
    .values({
      userId,
      kind: input.kind,
      amountKopecks: input.amountKopecks,
      description: input.description,
      idempotencyKey,
      categoryId,
      occurredAt: input.operationDate && occurredOn(input.operationDate),
    })
    .onConflictDoNothing({ target: [transactions.userId, transactions.idempotencyKey] })
    .returning({ id: transactions.id })
  return inserted?.id ?? null
}

export async function readOperationByKey(
  connection: Pick<Database, 'select'>,
  userId: string,
  idempotencyKey: string,
) {
  const [existing] = await connection
    .select({
      id: transactions.id,
      kind: transactions.kind,
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      deletedAt: transactions.deletedAt,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(and(eq(transactions.userId, userId), eq(transactions.idempotencyKey, idempotencyKey)))
    .limit(1)
  return existing ?? null
}

export async function hasOperation(
  connection: Pick<Database, 'select'>,
  userId: string,
  idempotencyKey: string,
) {
  const [existing] = await connection
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.idempotencyKey, idempotencyKey)))
    .limit(1)
  return Boolean(existing)
}

export async function readActiveOperationKind(
  connection: Pick<Database, 'select'>,
  userId: string,
  id: string,
): Promise<OperationKind | null> {
  const [operation] = await connection
    .select({ kind: transactions.kind })
    .from(transactions)
    .where(activeOperation(userId, id))
  return operation?.kind ?? null
}

export async function readMonthlyHistory(
  db: Database,
  userId: string,
  start: string,
  end: string,
  timeZone: string,
) {
  const occurredAt = transactions.occurredAt
  const localDate = sql`(${occurredAt} AT TIME ZONE ${timeZone})::date`
  return db
    .select({
      id: transactions.id,
      kind: transactions.kind,
      amountKopecks: transactions.amountKopecks,
      description: transactions.description,
      categoryName: categories.name,
      categoryKey: categories.starterKey,
      date: sql<string>`to_char(${localDate}, 'YYYY-MM-DD')`,
      time: sql<string | null>`CASE WHEN ${occurredAt} = ${transactions.createdAt}
        THEN to_char(${occurredAt} AT TIME ZONE ${timeZone}, 'HH24:MI') END`,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(
      and(
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt),
        // Bound the index scan before matching the user's local dates.
        sql`${occurredAt} >= (${start}::date::timestamp AT TIME ZONE 'UTC') - interval '24 hours'`,
        sql`${occurredAt} < (${end}::date::timestamp AT TIME ZONE 'UTC') + interval '24 hours'`,
        sql`${localDate} >= ${start}::date AND ${localDate} < ${end}::date`,
      ),
    )
    .orderBy(desc(localDate), desc(occurredAt), desc(transactions.id))
}

export function createOperationRepository(db: Database) {
  const operationFields = {
    id: transactions.id,
    kind: transactions.kind,
    amountKopecks: transactions.amountKopecks,
    description: transactions.description,
    createdAt: transactions.createdAt,
    categoryName: categories.name,
  }

  function selectOperations() {
    return db
      .select(operationFields)
      .from(transactions)
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
  }

  return {
    async recent(userId: string): Promise<OperationSummary[]> {
      return selectOperations()
        .where(and(eq(transactions.userId, userId), isNull(transactions.deletedAt)))
        .orderBy(desc(transactions.createdAt), desc(transactions.id))
        .limit(10)
    },

    async dailyHistory(
      userId: string,
      date: string,
      timeZone: string,
    ): Promise<OperationSummary[]> {
      const midnightUtc = sql`(${date}::date::timestamp AT TIME ZONE 'UTC')`
      const filter = and(
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt),
        // Bound the index scan, then match the local date even if midnight repeats or is skipped.
        sql`${transactions.occurredAt} >= ${midnightUtc} - interval '24 hours'`,
        sql`${transactions.occurredAt} < ${midnightUtc} + interval '48 hours'`,
        sql`(${transactions.occurredAt} AT TIME ZONE ${timeZone})::date = ${date}::date`,
      )

      return selectOperations()
        .where(filter)
        .orderBy(desc(transactions.occurredAt), desc(transactions.id))
    },

    async getOperation(userId: string, id: string): Promise<OperationDetails | null> {
      const zone = sql<string>`coalesce((SELECT time_zone FROM users WHERE id = ${userId}), 'UTC')`
      const operations = await db
        .select({
          ...operationFields,
          idempotencyKey: transactions.idempotencyKey,
          operationDate: {
            date: sql<string>`to_char(${transactions.occurredAt} AT TIME ZONE ${zone}, 'YYYY-MM-DD')`,
            timeZone: zone,
          },
        })
        .from(transactions)
        .leftJoin(categories, eq(transactions.categoryId, categories.id))
        .where(activeOperation(userId, id))
      return operations.at(0) ?? null
    },

    async setOperationDate(userId: string, id: string, date: OperationDate): Promise<boolean> {
      const instant = occurredOn(date)
      const [updated] = await db
        .update(transactions)
        .set({ occurredAt: instant })
        .where(and(activeOperation(userId, id), isNotNull(instant)))
        .returning({ id: transactions.id })
      return Boolean(updated)
    },

    getOperationKind(userId: string, id: string) {
      return readActiveOperationKind(db, userId, id)
    },

    async remove(userId: string, id: string): Promise<boolean> {
      const [removed] = await db
        .update(transactions)
        .set({ deletedAt: sql`now()` })
        .where(activeOperation(userId, id))
        .returning({ id: transactions.id })
      return Boolean(removed)
    },
  }
}
