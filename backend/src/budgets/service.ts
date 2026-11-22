import type { Database } from '../db/client.ts'
import { dateInZone } from '../shared/calendar.ts'
import { lockExpenseBudgetCategory, upsertMonthlyBudgetLimit } from './repository.ts'
import type { BudgetLimitChange, BudgetLimitResult, MonthlyBudget } from './types.ts'

type ReadTimeZone = (connection: Pick<Database, 'select'>, userId: string) => Promise<string | null>
type BudgetCategoryChoice = { id: string; name: string }
type BudgetViewDependencies = {
  getTimeZone: (userId: string) => Promise<string | null>
  listCategories: (userId: string, kind: 'expense') => Promise<BudgetCategoryChoice[]>
  monthlyBudget: (userId: string, month: string, timeZone: string) => Promise<MonthlyBudget>
}

function budgetMonthAt(timeZone: string, now?: Date): string {
  return `${dateInZone(timeZone, now).slice(0, 7)}-01`
}

export function createChangeBudgetLimit(db: Database, readTimeZone: ReadTimeZone) {
  return async function changeBudgetLimit(
    userId: string,
    month: string,
    categoryId: string | null,
    change: BudgetLimitChange,
    now?: Date,
  ): Promise<BudgetLimitResult> {
    return db.transaction(async (tx) => {
      const timeZone = (await readTimeZone(tx, userId)) ?? 'UTC'
      if (month !== budgetMonthAt(timeZone, now)) return 'stale'
      if (change.kind === 'set' && (change.amountKopecks === null || change.amountKopecks <= 0n))
        return 'invalid'
      if (categoryId !== null && !(await lockExpenseBudgetCategory(tx, userId, categoryId)))
        return 'unavailable'
      await upsertMonthlyBudgetLimit(
        tx,
        userId,
        month,
        categoryId,
        change.kind === 'set' ? change.amountKopecks : null,
      )
      return 'saved'
    })
  }
}

export function createBudgetViews({
  getTimeZone,
  listCategories,
  monthlyBudget,
}: BudgetViewDependencies) {
  async function editableTimeZone(userId: string, month: string): Promise<string | null> {
    const timeZone = (await getTimeZone(userId)) ?? 'UTC'
    return month === budgetMonthAt(timeZone) ? timeZone : null
  }

  return {
    async viewBudget(
      userId: string,
      month?: string,
    ): Promise<{ budget: MonthlyBudget; selected: string; current: string } | null> {
      const timeZone = (await getTimeZone(userId)) ?? 'UTC'
      const current = budgetMonthAt(timeZone)
      const selected = month ?? current
      if (selected > current) return null
      return { budget: await monthlyBudget(userId, selected, timeZone), selected, current }
    },

    async listBudgetCategoryChoices(
      userId: string,
      month: string,
    ): Promise<BudgetCategoryChoice[] | null> {
      if ((await editableTimeZone(userId, month)) === null) return null
      return listCategories(userId, 'expense')
    },

    async viewBudgetLimit(
      userId: string,
      month: string,
      categoryId: string | null,
    ): Promise<{ categoryName: string | null; limit: bigint | null } | null> {
      const timeZone = await editableTimeZone(userId, month)
      if (timeZone === null) return null
      const category =
        categoryId === null
          ? null
          : (await listCategories(userId, 'expense')).find(({ id }) => id === categoryId)
      if (category === undefined) return null

      const budget = await monthlyBudget(userId, month, timeZone)
      const limit =
        categoryId === null
          ? budget.totalLimit
          : (budget.categories.find(({ id }) => id === categoryId)?.limit ?? null)
      return { categoryName: category?.name ?? null, limit }
    },
  }
}
