export const periods = [
  { value: 'current-month', label: 'Месяц' },
  { value: 'current-week', label: 'Неделя' },
] as const

export type PresetPeriod = (typeof periods)[number]['value']
export type CustomPeriodMode = 'month' | 'week' | 'range'
export type CustomPeriod = {
  period: 'custom'
  mode: CustomPeriodMode
  startDate: string
  endDate: string
}
export type PeriodSelection = { period: PresetPeriod } | CustomPeriod

export type Amounts = {
  incomeKopecks: string
  expenseKopecks: string
}

export type Day = Amounts & {
  date: string
}

export type CategoryKind = 'income' | 'expense'

export type AnalyticsCategory = {
  id: string | null
  name: string
  amountKopecks: string
}

export type MonthlyBudget = {
  month: string
  spentKopecks: string
  limitKopecks: string | null
  categories: { id: string; name: string; spentKopecks: string; limitKopecks: string }[]
}

export type AnalyticsOverview = {
  period: PeriodSelection['period']
  startDate: string
  endDate: string
  timeZone: string
  usesUtcFallback: boolean
  currency: 'RUB'
  operationCount: number
  budget?: MonthlyBudget
  totals: Amounts & { differenceKopecks: string }
  days: Day[]
  expenseCategories: AnalyticsCategory[]
  expenseCategoriesByDay?: Record<string, AnalyticsCategory[]>
  incomeCategories: AnalyticsCategory[]
  incomeCategoriesByDay: Record<string, AnalyticsCategory[]>
}
