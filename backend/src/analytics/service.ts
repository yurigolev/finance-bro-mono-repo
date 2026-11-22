import { readMonthlyBudget } from '../budgets/repository.ts'
import type { MonthlyBudget } from '../budgets/types.ts'
import type { Database } from '../db/client.ts'
import { adjacentDay, adjacentMonth, dateInZone } from '../shared/calendar.ts'
import type { OperationKind } from '../transactions/types.ts'
import { readAnalyticsPeriod } from './repository.ts'
import type {
  AnalyticsOverview,
  AnalyticsPeriod,
  AnalyticsRange,
  LoadAnalyticsOverview,
} from './types.ts'

const uncategorized = 'Без категории'
const compareNames = new Intl.Collator('ru').compare

function periodDates(period: AnalyticsPeriod, today: string, range?: AnalyticsRange) {
  if (period === 'custom') {
    if (!range) throw new RangeError('Для произвольного периода нужны даты.')
    return range
  }
  const monthStart = `${today.slice(0, 7)}-01`
  if (period === 'current-month') return { startDate: monthStart, endDate: today }
  if (period === 'current-week') {
    const weekday = new Date(today).getUTCDay()
    return { startDate: adjacentDay(today, -((weekday + 6) % 7)), endDate: today }
  }
  if (period === 'last-7-days') return { startDate: adjacentDay(today, -6), endDate: today }

  const endDate = adjacentDay(monthStart, -1)
  return { startDate: `${endDate.slice(0, 7)}-01`, endDate }
}

async function readBudgetForPeriod(
  connection: Parameters<typeof readMonthlyBudget>[0],
  userId: string,
  firstMonth: string,
  lastMonth: string,
  timeZone: string,
): Promise<MonthlyBudget> {
  let totalSpent = 0n
  let totalLimit: bigint | null = 0n
  const categories = new Map<string, MonthlyBudget['categories'][number]>()

  for (let month = firstMonth; ; month = adjacentMonth(month, 1)) {
    const budget = await readMonthlyBudget(connection, userId, `${month}-01`, timeZone)
    totalSpent += budget.totalSpent
    totalLimit =
      totalLimit === null || budget.totalLimit === null ? null : totalLimit + budget.totalLimit

    for (const category of budget.categories) {
      const previous = categories.get(category.id)
      categories.set(category.id, {
        ...category,
        limit: (previous?.limit ?? 0n) + category.limit,
        spent: (previous?.spent ?? 0n) + category.spent,
      })
    }

    if (month === lastMonth) break
  }

  return { totalSpent, totalLimit, categories: [...categories.values()] }
}

type ReadTimeZone = (connection: Pick<Database, 'select'>, userId: string) => Promise<string | null>
type CategoryBreakdown = {
  period: AnalyticsOverview['expenseCategories']
  byDay: AnalyticsOverview['expenseCategoriesByDay']
}

export function createAnalyticsOverview(
  db: Database,
  readTimeZone: ReadTimeZone,
): LoadAnalyticsOverview {
  return (userId, period, now, range) =>
    db.transaction(
      async (tx) => {
        const savedTimeZone = userId === null ? null : await readTimeZone(tx, userId)
        const timeZone = savedTimeZone ?? 'UTC'
        const today = dateInZone(timeZone, now)
        const { startDate, endDate } = periodDates(period, today, range)
        const firstBudgetMonth = startDate.slice(0, 7)
        const lastBudgetMonth = endDate.slice(0, 7)
        const budget =
          userId === null
            ? null
            : await readBudgetForPeriod(tx, userId, firstBudgetMonth, lastBudgetMonth, timeZone)
        const { dailyRows, categoryRows } =
          userId === null
            ? { dailyRows: [], categoryRows: [] }
            : await readAnalyticsPeriod(tx, userId, startDate, endDate, timeZone)

        const dailyByDate = new Map(dailyRows.map((row) => [row.date, row]))
        const days = []
        let income = 0n
        let expense = 0n
        let operationCount = 0
        for (let date = startDate; date <= endDate; date = adjacentDay(date, 1)) {
          const row = dailyByDate.get(date)
          const incomeKopecks = row?.incomeKopecks ?? '0'
          const expenseKopecks = row?.expenseKopecks ?? '0'
          days.push({ date, incomeKopecks, expenseKopecks })
          income += BigInt(incomeKopecks)
          expense += BigInt(expenseKopecks)
          operationCount += Number(row?.operationCount ?? 0)
        }

        const rankedCategories = categoryRows
          .map(({ date, kind, id, name, amountKopecks }) => ({
            date,
            kind,
            id,
            name: name ?? uncategorized,
            amountKopecks,
          }))
          .sort((a, b) => {
            const difference = BigInt(b.amountKopecks) - BigInt(a.amountKopecks)
            if (difference !== 0n) return difference > 0n ? 1 : -1
            return compareNames(a.name, b.name) || (a.id ?? '').localeCompare(b.id ?? '')
          })

        const categoriesByKind: Record<OperationKind, CategoryBreakdown> = {
          expense: { period: [], byDay: {} },
          income: { period: [], byDay: {} },
        }
        for (const { date, kind, ...category } of rankedCategories) {
          const breakdown = categoriesByKind[kind]
          if (date === null) breakdown.period.push(category)
          else (breakdown.byDay[date] ??= []).push(category)
        }

        return {
          period,
          startDate,
          endDate,
          timeZone,
          usesUtcFallback: savedTimeZone === null,
          currency: 'RUB',
          operationCount,
          budget: {
            month: `${firstBudgetMonth}-01`,
            spentKopecks: budget?.totalSpent.toString() ?? '0',
            limitKopecks: budget?.totalLimit?.toString() ?? null,
            categories:
              budget?.categories.map(({ id, name, limit, spent }) => ({
                id,
                name,
                limitKopecks: limit.toString(),
                spentKopecks: spent.toString(),
              })) ?? [],
          },
          totals: {
            incomeKopecks: income.toString(),
            expenseKopecks: expense.toString(),
            differenceKopecks: (income - expense).toString(),
          },
          days,
          expenseCategories: categoriesByKind.expense.period,
          expenseCategoriesByDay: categoriesByKind.expense.byDay,
          incomeCategories: categoriesByKind.income.period,
          incomeCategoriesByDay: categoriesByKind.income.byDay,
        }
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    )
}
