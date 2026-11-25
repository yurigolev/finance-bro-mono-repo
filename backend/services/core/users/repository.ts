import { eq, sql } from 'drizzle-orm'
import type { Database } from '../db/client.ts'
import { users } from '../db/schema.ts'

export async function findUserIdByTelegramId(
  connection: Pick<Database, 'select'>,
  telegramId: number,
): Promise<string | null> {
  const [user] = await connection
    .select({ id: users.id })
    .from(users)
    .where(eq(users.telegramId, telegramId))
  return user?.id ?? null
}

export async function readTimeZone(
  connection: Pick<Database, 'select'>,
  userId: string,
): Promise<string | null> {
  const [user] = await connection
    .select({ timeZone: users.timeZone })
    .from(users)
    .where(eq(users.id, userId))
  return user?.timeZone ?? null
}

export async function timeZoneExists(connection: Pick<Database, 'execute'>, timeZone: string) {
  const { rows } = await connection.execute(sql`
    SELECT name FROM pg_catalog.pg_timezone_names WHERE name = ${timeZone} LIMIT 1
  `)
  return rows.length > 0
}

export function createUserRepository(db: Database) {
  return {
    findUserIdByTelegramId: (telegramId: number) => findUserIdByTelegramId(db, telegramId),
    readTimeZone: (userId: string) => readTimeZone(db, userId),

    async insertUser(telegramId: number): Promise<string | null> {
      const [inserted] = await db
        .insert(users)
        .values({ telegramId })
        .onConflictDoNothing({ target: users.telegramId })
        .returning({ id: users.id })
      return inserted?.id ?? null
    },

    timeZoneExists: (timeZone: string) => timeZoneExists(db, timeZone),

    async updateTimeZone(
      userId: string,
      timeZone: string | null,
    ): Promise<{ timeZone: string | null } | undefined> {
      const [updated] = await db
        .update(users)
        .set({ timeZone })
        .where(eq(users.id, userId))
        .returning({ timeZone: users.timeZone })
      return updated
    },
  }
}
