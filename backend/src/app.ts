import { createAnalyticsOverview } from './analytics/service.ts'
import { readMonthlyBudget } from './budgets/repository.ts'
import { createBudgetViews, createChangeBudgetLimit } from './budgets/service.ts'
import { categoryMatching, createCategoryService } from './categories/service.ts'
import type { Database } from './db/client.ts'
import type { TelegramDependencies } from './telegram/dependencies.ts'
import {
  createOperationRepository,
  hasOperation,
  insertOperation,
} from './transactions/repository.ts'
import { createLoadDailyHistory, createRecordOperation } from './transactions/service.ts'
import { createUserRepository, readTimeZone } from './users/repository.ts'
import { createUserService } from './users/service.ts'

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

export function createApplication(db: Database) {
  const userRepository = createUserRepository(db)
  const operationRepository = createOperationRepository(db)
  const categories = createCategoryService(db)
  const monthlyBudget: TelegramDependencies['budgets']['monthlyBudget'] = (
    userId,
    month,
    timeZone,
  ) => readMonthlyBudget(db, userId, month, timeZone)
  const telegram: TelegramDependencies = {
    users: { ...createUserService(userRepository), getTimeZone: userRepository.readTimeZone },
    categories,
    transactions: {
      ...operationRepository,
      loadDailyHistory: createLoadDailyHistory({
        getTimeZone: userRepository.readTimeZone,
        dailyHistory: operationRepository.dailyHistory,
      }),
      recordOperation: createRecordOperation<Transaction>({
        ...categoryMatching,
        withTransaction: (run) => db.transaction(run),
        insertOperation,
        hasOperation,
      }),
    },
    budgets: {
      monthlyBudget,
      changeBudgetLimit: createChangeBudgetLimit(db, readTimeZone),
      ...createBudgetViews({
        getTimeZone: userRepository.readTimeZone,
        listCategories: categories.listCategories,
        monthlyBudget,
      }),
    },
  }

  return {
    telegram,
    analytics: {
      resolveUserId: userRepository.findUserIdByTelegramId,
      loadOverview: createAnalyticsOverview(db, readTimeZone),
    },
  }
}
