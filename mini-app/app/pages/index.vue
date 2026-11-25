<script setup lang="ts">
import { ArrowDown, ArrowUp, TrendingDown, TrendingUp } from '@lucide/vue'
import { endOfMonth, parseDate, startOfMonth, startOfWeek, today } from '@internationalized/date'
import {
  periods,
  type CategoryKind,
  type PeriodSelection,
  type PresetPeriod,
} from '#shared/types/analytics'
import UiSkeleton from '~/components/ui/UiSkeleton.vue'
import UiSegmentedRadioGroup from '~/components/ui/UiSegmentedRadioGroup.vue'
import { formatDateRange, formatKopecks, formatMonthRange } from '~/utils/analytics-format'

defineOptions({ name: 'AnalyticsOverviewPage' })
definePageMeta({ alias: '/index.html', scrollToTop: false })

const period = ref<PeriodSelection>({ period: 'current-month' })
const { pending, run } = usePendingAction<PresetPeriod | 'previous' | 'next' | 'apply' | 'retry'>()
const preset = computed({
  get: () => (period.value.period === 'custom' ? '' : period.value.period),
  set: (value: PresetPeriod | '') => {
    if (value && value !== period.value.period) void changePeriod(value, { period: value })
  },
})
const categoryKind = ref<CategoryKind>('expense')
const categoryOptions = [
  { value: 'income', label: 'Доходы' },
  { value: 'expense', label: 'Расходы' },
] as const
const { state, load } = useAnalyticsOverview(period)
const overview = computed(() => (state.value.status === 'ready' ? state.value.overview : undefined))
const periodMode = computed(() =>
  period.value.period === 'custom'
    ? period.value.mode
    : period.value.period === 'current-month'
      ? 'month'
      : 'week',
)
const previousPeriod = computed(() => adjacentPeriod(-1))
const nextPeriod = computed(() => adjacentPeriod(1))
const timeZone = ref('UTC')
watch(overview, (value) => {
  if (value) timeZone.value = value.timeZone
})
const difference = computed(() =>
  overview.value ? BigInt(overview.value.totals.differenceKopecks) : 0n,
)
const hasDeficit = computed(() => difference.value < 0n)
const initData = useTelegramWebApp(refresh)

function adjacentPeriod(direction: -1 | 1): PeriodSelection | undefined {
  const current = overview.value
  const mode = periodMode.value
  if (!current || mode === 'range') return

  const start = parseDate(current.startDate)
  const now = today(current.timeZone)
  if (mode === 'day') {
    const target = start.add({ days: direction })
    if (target.compare(start) * direction <= 0 || target.compare(now) > 0) return
    const date = target.toString()
    return { period: 'custom', mode, startDate: date, endDate: date }
  }

  const target = start.add(mode === 'month' ? { months: direction } : { weeks: direction })
  if (target.compare(start) * direction <= 0) return

  const currentStart = mode === 'month' ? startOfMonth(now) : startOfWeek(now, 'ru-RU')
  const offset = target.compare(currentStart)
  if (offset > 0) return
  if (offset === 0) return { period: mode === 'month' ? 'current-month' : 'current-week' }

  const end = mode === 'month' ? endOfMonth(target) : target.add({ days: 6 })
  return {
    period: 'custom',
    mode,
    startDate: target.toString(),
    endDate: end.toString(),
  }
}

function refresh(background = false) {
  return load(initData, background)
}

function changePeriod(
  action: Exclude<NonNullable<typeof pending.value>, 'retry'>,
  next: PeriodSelection,
) {
  return run(action, async () => {
    await load(initData, false, next)
    period.value = next
  })
}
</script>

<template>
  <main
    class="analytics"
    :class="{ 'overview-with-period': state.status !== 'telegram-required' }"
    aria-label="Аналитика"
  >
    <template v-if="state.status === 'telegram-required'">
      <p class="message" role="status">Откройте аналитику из меню бота</p>
    </template>

    <template v-else>
      <div class="overview-period" role="group" aria-label="Период обзора">
        <div class="period-picker">
          <UiSegmentedRadioGroup
            v-model="preset"
            class="analytics-glass"
            :options="periods"
            :pending="
              pending === 'current-month' || pending === 'current-week' ? pending : undefined
            "
            :disabled="!!pending"
            aria-label="Быстрый выбор периода"
          />
          <PeriodDialog
            glass-trigger
            :selection="period.period === 'custom' ? period : undefined"
            :time-zone="timeZone"
            :disabled="!!pending"
            :loading="pending === 'apply'"
            @apply="changePeriod('apply', $event)"
          />
        </div>
        <PeriodNavigation
          v-if="state.status !== 'error' && pending !== 'retry'"
          class="analytics-glass"
          :has-previous="!!previousPeriod"
          :has-next="!!nextPeriod"
          :previous-label="periodMode === 'day' ? 'Предыдущий день' : undefined"
          :next-label="periodMode === 'day' ? 'Следующий день' : undefined"
          :pending="pending === 'previous' || pending === 'next' ? pending : undefined"
          :disabled="!!pending"
          @previous="previousPeriod && changePeriod('previous', previousPeriod)"
          @next="nextPeriod && changePeriod('next', nextPeriod)"
        >
          <template v-if="overview">{{
            periodMode === 'month'
              ? `${formatMonthRange(overview.startDate, overview.startDate)} ${overview.startDate.slice(0, 4)}`
              : formatDateRange(overview.startDate, overview.endDate)
          }}</template>
          <UiSkeleton v-else class="range-placeholder" />
        </PeriodNavigation>
      </div>

      <div v-if="state.status === 'error' || pending === 'retry'" class="error-state">
        <p class="message" role="alert">Не удалось загрузить аналитику</p>
        <UiAsyncButton class="retry" :loading="pending === 'retry'" @click="run('retry', refresh)">
          Повторить
        </UiAsyncButton>
      </div>

      <div v-else :aria-busy="state.status === 'loading'">
        <section class="analytics-section totals" aria-label="Итоги за период">
          <dl class="metric-list">
            <div
              class="metric metric-primary"
              :class="{
                'metric-deficit': hasDeficit,
                'metric-surplus': difference > 0n,
                'metric-highlight': overview,
              }"
            >
              <dt>
                Разница
                <TrendingDown v-if="hasDeficit" class="metric-icon" aria-hidden="true" />
                <TrendingUp v-else-if="difference > 0n" class="metric-icon" aria-hidden="true" />
                <span v-if="difference !== 0n" class="difference-badge" aria-hidden="true">{{
                  hasDeficit ? '😢' : '💰'
                }}</span>
              </dt>
              <dd>
                <span v-if="overview" class="difference-amount">{{
                  formatKopecks(overview.totals.differenceKopecks, true)
                }}</span>
                <UiSkeleton v-else class="total-placeholder" />
              </dd>
            </div>
            <div class="metric metric-income">
              <dt>Доходы <ArrowUp class="metric-icon" aria-hidden="true" /></dt>
              <dd>
                <template v-if="overview">{{
                  formatKopecks(overview.totals.incomeKopecks)
                }}</template>
                <UiSkeleton v-else class="total-placeholder" />
              </dd>
            </div>
            <div class="metric metric-expense">
              <dt>Расходы <ArrowDown class="metric-icon" aria-hidden="true" /></dt>
              <dd>
                <template v-if="overview">{{
                  formatKopecks(overview.totals.expenseKopecks)
                }}</template>
                <UiSkeleton v-else class="total-placeholder" />
              </dd>
            </div>
          </dl>
          <p v-if="overview?.operationCount === 0" class="message">За этот период операций нет</p>
        </section>

        <BudgetOverview
          v-if="!overview || overview.budget"
          :budget="overview?.budget"
          :period-label="overview && formatMonthRange(overview.startDate, overview.endDate)"
        />

        <section class="analytics-section" aria-labelledby="days-heading">
          <h2 id="days-heading">По дням</h2>
          <DayChart v-if="overview" :days="overview.days" />
          <div v-else class="day-placeholder">
            <UiSkeleton class="legend-placeholder" />
            <UiSkeleton class="plot-placeholder" />
          </div>
        </section>

        <section class="categories-section" aria-labelledby="categories-heading">
          <div class="categories-header">
            <h2 id="categories-heading">По категориям</h2>
            <UiSegmentedRadioGroup
              v-model="categoryKind"
              :options="categoryOptions"
              class="period-control-compact category-kind-control"
              aria-label="Тип операций по категориям"
            />
          </div>
          <CategoryBreakdown
            v-if="overview"
            :key="categoryKind"
            :kind="categoryKind"
            :categories="overview[`${categoryKind}Categories`]"
            :total-kopecks="overview.totals[`${categoryKind}Kopecks`]"
            :daily="periodMode === 'day'"
          />
          <div v-else class="categories-placeholder">
            <UiSkeleton v-for="index in 3" :key="index" class="category-placeholder" />
          </div>
        </section>
      </div>
    </template>
  </main>
</template>

<style scoped>
.overview-with-period {
  padding-top: 0;
}

.overview-period {
  position: sticky;
  z-index: 3;
  top: 0;
  display: flow-root;
  padding-top: calc(8px + var(--analytics-top-inset));
}

.totals {
  padding-top: 22px;
}

@property --difference-ring-angle {
  syntax: '<angle>';
  inherits: false;
  initial-value: 0deg;
}

.metric-primary {
  position: relative;
  padding: 10px 16px 12px;
}

.metric-surplus {
  --metric-accent: var(--summary-income);
  background: var(--summary-surplus-surface);
}

.difference-badge {
  position: absolute;
  z-index: 1;
  top: -10px;
  right: 6px;
  font-size: 40px;
  line-height: 1;
  transform: rotate(16deg);
  pointer-events: none;
}

.metric-deficit .difference-badge {
  transform: rotate(-16deg);
}

@supports (mask-composite: exclude) and (color: color-mix(in srgb, black, white)) {
  .metric-highlight::after {
    --ring-color: var(--metric-accent, var(--text));
    --ring-base: color-mix(in srgb, var(--ring-color) 10%, transparent);
    --ring-peak: color-mix(in srgb, var(--ring-color) 65%, white);

    content: '';
    position: absolute;
    inset: 0;
    padding: 2px;
    border-radius: inherit;
    background: conic-gradient(
      from var(--difference-ring-angle, 0deg),
      var(--ring-base) 12%,
      color-mix(in srgb, var(--ring-color) 32.528%, transparent) 23%,
      color-mix(in srgb, var(--ring-peak) 40.96%, var(--ring-base)) 30%,
      color-mix(in srgb, var(--ring-color) 32.528%, transparent) 37%,
      var(--ring-base) 50%
    );
    mask:
      linear-gradient(black 0 0) content-box,
      linear-gradient(black 0 0);
    mask-composite: exclude;
    pointer-events: none;
  }
}

@media (prefers-reduced-motion: no-preference) {
  .metric-highlight::after {
    animation: difference-ring 8s linear infinite;
  }

  @supports (background-clip: text) and (color: color-mix(in srgb, black, white)) {
    .difference-amount {
      --amount-color: var(--metric-accent, var(--text));
      background-image: linear-gradient(
        110deg,
        var(--amount-color) 43%,
        color-mix(in srgb, var(--amount-color), white 25%) 50%,
        var(--amount-color) 57%
      );
      background-size: 250% 100%;
      background-clip: text;
      color: transparent;
      animation: difference-shine 3s linear infinite;
    }
  }
}

@keyframes difference-ring {
  to {
    --difference-ring-angle: 360deg;
  }
}

@keyframes difference-shine {
  0%,
  52% {
    background-position: 100% 0;
  }
  100% {
    background-position: 0 0;
  }
}
</style>
