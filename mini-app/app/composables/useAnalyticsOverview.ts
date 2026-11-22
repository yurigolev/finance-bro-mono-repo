import type { AnalyticsOverview, PeriodSelection } from '#shared/types/analytics'

type AnalyticsState =
  | { status: 'loading' | 'telegram-required' | 'error' }
  | { status: 'ready'; overview: AnalyticsOverview }

export function useAnalyticsOverview(
  period: Readonly<Ref<PeriodSelection | { period: 'previous-month' }>>,
) {
  const state = shallowRef<AnalyticsState>({ status: 'loading' })
  const selectedDate = ref('')
  let activeRequest: AbortController | undefined

  async function load(initData?: string, background = false) {
    if (background && activeRequest) return
    const retainOverview = background && state.value.status === 'ready'
    activeRequest?.abort()
    if (!initData) {
      state.value = { status: 'telegram-required' }
      return
    }

    const request = new AbortController()
    const requestedPeriod = period.value
    const query = new URLSearchParams({ period: requestedPeriod.period })
    if (requestedPeriod.period === 'custom') {
      query.set('startDate', requestedPeriod.startDate)
      query.set('endDate', requestedPeriod.endDate)
    }
    activeRequest = request
    if (!retainOverview) state.value = { status: 'loading' }

    try {
      const response = await fetch(`/api/analytics/overview?${query}`, {
        headers: { 'X-Telegram-Init-Data': initData },
        cache: 'no-store',
        redirect: 'error',
        signal: request.signal,
      })
      if (request.signal.aborted) return

      if (response.status === 401) {
        state.value = { status: 'telegram-required' }
        return
      }
      if (!response.ok) {
        if (!retainOverview) state.value = { status: 'error' }
        return
      }

      const overview: AnalyticsOverview = await response.json()
      if (request.signal.aborted) return
      if (
        overview.period !== requestedPeriod.period ||
        (requestedPeriod.period === 'custom' &&
          (overview.startDate !== requestedPeriod.startDate ||
            overview.endDate !== requestedPeriod.endDate))
      ) {
        if (!retainOverview) state.value = { status: 'error' }
        return
      }

      if (!overview.days.some((day) => day.date === selectedDate.value)) {
        selectedDate.value = overview.endDate
      }
      state.value = { status: 'ready', overview }
    } catch {
      if (!request.signal.aborted && !retainOverview) state.value = { status: 'error' }
    } finally {
      if (activeRequest === request) activeRequest = undefined
    }
  }

  onUnmounted(() => activeRequest?.abort())

  return { state, selectedDate, load }
}
