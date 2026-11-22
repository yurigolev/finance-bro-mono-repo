import type { readMonthlyBudget } from '../budgets/repository.ts'
import type { createBudgetViews, createChangeBudgetLimit } from '../budgets/service.ts'
import type { CategoryService } from '../categories/types.ts'
import type { createOperationRepository } from '../transactions/repository.ts'
import type { createLoadDailyHistory } from '../transactions/service.ts'
import type { OperationDraft, RecordOperationResult } from '../transactions/types.ts'
import type { createUserRepository } from '../users/repository.ts'
import type { createUserService } from '../users/service.ts'

export type TelegramDependencies = {
  users: ReturnType<typeof createUserService> & {
    getTimeZone: ReturnType<typeof createUserRepository>['readTimeZone']
  }
  categories: CategoryService
  transactions: ReturnType<typeof createOperationRepository> & {
    loadDailyHistory: ReturnType<typeof createLoadDailyHistory>
    recordOperation: (
      userId: string,
      input: OperationDraft,
      idempotencyKey: string,
    ) => Promise<RecordOperationResult>
  }
  budgets: ReturnType<typeof createBudgetViews> & {
    monthlyBudget: (
      userId: string,
      month: string,
      timeZone: string,
    ) => ReturnType<typeof readMonthlyBudget>
    changeBudgetLimit: ReturnType<typeof createChangeBudgetLimit>
  }
}

export type WithOwner = <T>(
  telegramId: number,
  operation: (userId: string) => Promise<T>,
) => Promise<T | undefined>
export type QueueMessageUpdate = <T>(key: string, update: () => Promise<T>) => Promise<T>
