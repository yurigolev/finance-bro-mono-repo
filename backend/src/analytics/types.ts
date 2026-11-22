import { z } from 'zod'
import { serializedKopecksPattern } from './patterns.ts'

export const analyticsPeriodSchema = z.enum([
  'current-month',
  'current-week',
  'last-7-days',
  'previous-month',
  'custom',
])
export type AnalyticsPeriod = z.infer<typeof analyticsPeriodSchema>

export const analyticsRangeSchema = z
  .object({ startDate: z.iso.date(), endDate: z.iso.date() })
  .refine(({ startDate, endDate }) => {
    const length = Date.parse(endDate) - Date.parse(startDate)
    return (
      startDate >= '0001-01-01' &&
      endDate < '9999-12-31' &&
      length >= 0 &&
      length < 366 * 86_400_000
    )
  })

export type AnalyticsRange = z.infer<typeof analyticsRangeSchema>

const kopecks = z.string().regex(serializedKopecksPattern)
const flow = z.object({ incomeKopecks: kopecks, expenseKopecks: kopecks })

const analyticsCategory = z.object({
  id: z.string().nullable(),
  name: z.string(),
  amountKopecks: kopecks,
})

export const analyticsOverviewSchema = z.object({
  period: analyticsPeriodSchema,
  startDate: z.iso.date(),
  endDate: z.iso.date(),
  timeZone: z.string(),
  usesUtcFallback: z.boolean(),
  currency: z.literal('RUB'),
  operationCount: z.int().nonnegative(),
  budget: z.object({
    month: z.iso.date(),
    spentKopecks: kopecks,
    limitKopecks: kopecks.nullable(),
    categories: z.array(
      z.object({ id: z.string(), name: z.string(), limitKopecks: kopecks, spentKopecks: kopecks }),
    ),
  }),
  totals: flow.extend({ differenceKopecks: kopecks }),
  days: z.array(flow.extend({ date: z.iso.date() })),
  expenseCategories: z.array(analyticsCategory),
  expenseCategoriesByDay: z.record(z.iso.date(), z.array(analyticsCategory)),
  incomeCategories: z.array(analyticsCategory),
  incomeCategoriesByDay: z.record(z.iso.date(), z.array(analyticsCategory)),
})

export type AnalyticsOverview = z.infer<typeof analyticsOverviewSchema>

export type LoadAnalyticsOverview = (
  userId: string | null,
  period: AnalyticsPeriod,
  now: Date,
  range?: AnalyticsRange,
) => Promise<AnalyticsOverview>
