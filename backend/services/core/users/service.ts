import type { TimeZoneUpdate } from '../../../packages/contracts/users.ts'
import type { createUserRepository } from './repository.ts'

function normalizeTimeZone(input: string): string | null {
  try {
    const timeZone = new Intl.DateTimeFormat('en', { timeZone: input.trim() }).resolvedOptions()
      .timeZone
    // Intl also accepts numeric offsets, which are not named time zones.
    return timeZone.startsWith('+') || timeZone.startsWith('-') ? null : timeZone
  } catch (error) {
    if (error instanceof RangeError) return null
    throw error
  }
}

type UserRepository = Pick<
  ReturnType<typeof createUserRepository>,
  'insertUser' | 'findUserIdByTelegramId' | 'timeZoneExists' | 'updateTimeZone'
>

export function createUserService(repository: UserRepository) {
  return {
    async getOrCreateUser(telegramId: number): Promise<string> {
      const inserted = await repository.insertUser(telegramId)
      if (inserted) return inserted

      const existing = await repository.findUserIdByTelegramId(telegramId)
      if (!existing) throw new Error('FinanceBro user could not be resolved')
      return existing
    },

    async setTimeZone(userId: string, timeZone: string | null): Promise<TimeZoneUpdate> {
      let storedTimeZone: string | null = null
      if (timeZone !== null) {
        storedTimeZone = normalizeTimeZone(timeZone)
        // A zone known to Intl may be missing from the database server's tzdata.
        if (storedTimeZone === null || !(await repository.timeZoneExists(storedTimeZone)))
          return 'invalid'
      }

      return (await repository.updateTimeZone(userId, storedTimeZone)) ?? 'unavailable'
    },
  }
}
