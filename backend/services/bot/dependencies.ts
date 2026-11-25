export type { TelegramDependencies } from '../../packages/contracts/telegram-dependencies.ts'

export type WithOwner = <T>(
  telegramId: number,
  operation: (userId: string) => Promise<T>,
) => Promise<T | undefined>
export type QueueMessageUpdate = <T>(key: string, update: () => Promise<T>) => Promise<T>
