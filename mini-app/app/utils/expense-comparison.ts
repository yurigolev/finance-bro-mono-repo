import { parseDate } from '@internationalized/date'
import type { AnalyticsOverview } from '#shared/types/analytics'
import { formatMonthRange } from './analytics-format'

export function compareExpenses(a: AnalyticsOverview, b: AnalyticsOverview) {
  if (
    a.timeZone !== b.timeZone ||
    parseDate(a.startDate).subtract({ months: 1 }).toString() !== b.startDate
  )
    return
  const count = Math.min(a.days.length, b.days.length)
  if (!count) return
  const changes = new Map<string | null, { name: string; amount: bigint }>()
  let currentTotal = 0n
  let previousTotal = 0n

  function addCategories(overview: AnalyticsOverview, sign: bigint) {
    const categories =
      count === overview.days.length
        ? overview.expenseCategories
        : overview.days
            .slice(0, count)
            .flatMap(({ date }) => overview.expenseCategoriesByDay?.[date] ?? [])
    for (const { id, name, amountKopecks } of categories) {
      const amount = (changes.get(id)?.amount ?? 0n) + sign * BigInt(amountKopecks)
      changes.set(id, { name, amount })
    }
  }

  addCategories(b, -1n)
  addCategories(a, 1n)
  const rows = a.days.slice(0, count).map((day, index) => {
    const currentDay = BigInt(day.expenseKopecks)
    const previousDay = BigInt(b.days[index]!.expenseKopecks)
    currentTotal += currentDay
    previousTotal += previousDay
    return { day: index + 1, currentDay, previousDay, currentTotal, previousTotal }
  })
  const absolute = (amount: bigint) => (amount < 0n ? -amount : amount)
  const categories = [...changes.entries()]
    .map(([id, category]) => ({ id, ...category }))
    .filter(({ amount }) => amount !== 0n)
    .sort((a, b) =>
      absolute(a.amount) > absolute(b.amount)
        ? -1
        : absolute(a.amount) < absolute(b.amount)
          ? 1
          : a.name.localeCompare(b.name, 'ru'),
    )
  const increases = categories.filter(({ amount }) => amount > 0n)
  const decreases = categories.filter(({ amount }) => amount < 0n)
  const increaseTotal = increases.reduce((total, { amount }) => total + amount, 0n)
  const decreaseTotal = decreases.reduce((total, { amount }) => total + amount, 0n)
  return {
    rows,
    total: currentTotal - previousTotal,
    currentTotal,
    previousTotal,
    currentMonth: formatMonthRange(a.startDate, a.startDate),
    previousMonth: formatMonthRange(b.startDate, b.startDate),
    categories: [...increases, ...decreases],
    segments: [...decreases, ...increases],
    increaseTotal,
    decreaseTotal,
  }
}

export type ExpenseComparison = NonNullable<ReturnType<typeof compareExpenses>>
