import { compareExpenses } from '~/utils/expense-comparison'

export type ExpenseComparisonStatus = 'loading' | 'telegram-required' | 'error' | 'ready'

export function useExpenseComparison() {
  const current = useAnalyticsOverview(ref({ period: 'current-month' } as const))
  const previous = useAnalyticsOverview(ref({ period: 'previous-month' } as const))
  const comparison = computed(() => {
    const first = current.state.value
    const second = previous.state.value
    if (first.status === 'ready' && second.status === 'ready') {
      return compareExpenses(first.overview, second.overview)
    }
  })
  const status = computed<ExpenseComparisonStatus>(() => {
    const statuses = [current.state.value.status, previous.state.value.status]
    if (statuses.includes('telegram-required')) return 'telegram-required'
    if (statuses.includes('error')) return 'error'
    if (statuses.includes('loading')) return 'loading'
    return comparison.value ? 'ready' : 'error'
  })

  async function load(initData?: string, background = false) {
    await Promise.all([current.load(initData, background), previous.load(initData, background)])
  }

  return { comparison, status, load }
}
