<script setup lang="ts">
import { endOfMonth, parseDate, startOfMonth, today } from '@internationalized/date'
import VisArea from '@unovis/vue/components/area'
import VisAxis from '@unovis/vue/components/axis'
import VisLine from '@unovis/vue/components/line'
import VisScatter from '@unovis/vue/components/scatter'
import VisXYContainer from '@unovis/vue/containers/xy-container'
import type { PeriodSelection } from '#shared/types/analytics'
import { formatKopecks, formatKopecksAmount, formatMonthRange } from '~/utils/analytics-format'

defineOptions({ name: 'MonthlyBudgetsPage' })
definePageMeta({ scrollToTop: false })
useHead({ title: 'Бюджеты' })

const period = ref<PeriodSelection>({ period: 'current-month' })
const { pending, run } = usePendingAction<'previous' | 'next' | 'retry'>()
const { state, load } = useAnalyticsOverview(period)
const initData = useTelegramWebApp(refresh)
const chartHeight = 220
const overview = computed(() => (state.value.status === 'ready' ? state.value.overview : undefined))
const timeZone = ref<string>()
const selectedMonth = computed(() => {
  if (period.value.period === 'custom') return parseDate(period.value.startDate)
  if (overview.value) return parseDate(overview.value.startDate)
  if (timeZone.value) return startOfMonth(today(timeZone.value))
})
const selectedMonthLabel = computed(() => {
  const date = selectedMonth.value?.toString()
  return date ? `${formatMonthRange(date, date)} ${date.slice(0, 4)}` : ''
})
const monthName = new Intl.DateTimeFormat('ru-RU', { month: 'long', timeZone: 'UTC' })
const compact = new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 })
const percentFormat = new Intl.NumberFormat('ru-RU', { style: 'percent' })

function refresh(background = false) {
  return load(initData, background)
}

watch(overview, (value) => {
  if (value) timeZone.value = value.timeZone
})
function shiftMonth(direction: -1 | 1) {
  const month = selectedMonth.value
  const zone = timeZone.value
  if (!month || !zone) return

  const target = month.add({ months: direction })
  if (target.compare(month) * direction <= 0) return

  return run(direction === -1 ? 'previous' : 'next', async () => {
    period.value =
      target.compare(startOfMonth(today(zone))) === 0
        ? { period: 'current-month' }
        : {
            period: 'custom',
            mode: 'month',
            startDate: target.toString(),
            endDate: endOfMonth(target).toString(),
          }
    await refresh()
  })
}

function percent(amount: bigint, total: bigint) {
  return total > 0n ? Number((amount * 10000n) / total) / 10000 : 0
}

type Point = { day: number; rubles: number }
const x = (point: Point) => point.day
const y = (point: Point) => point.rubles

const details = computed(() => {
  const current = overview.value
  if (!current) return

  const month = parseDate(current.startDate)
  const dayCount = endOfMonth(month).day
  const now = today(current.timeZone)
  const periodEnd = parseDate(current.endDate)
  const elapsedEnd = periodEnd.compare(now) > 0 ? now : periodEnd
  const elapsed = month.compare(elapsedEnd) > 0 ? 0 : elapsedEnd.day
  const budget = current.budget
  const limit = budget?.limitKopecks ? BigInt(budget.limitKopecks) : null
  const spent = BigInt(budget?.spentKopecks ?? current.totals.expenseKopecks)
  let runningTotal = 0n
  const actual = [
    { day: 0, rubles: 0 },
    ...current.days.slice(0, elapsed).map(({ date, expenseKopecks }) => {
      runningTotal += BigInt(expenseKopecks)
      return { day: Number(date.slice(-2)), rubles: Number(runningTotal) / 100 }
    }),
  ]
  const target =
    limit === null
      ? []
      : [
          { day: 0, rubles: 0 },
          { day: dayCount, rubles: Number(limit) / 100 },
        ]
  const ticks = [...new Set([1, 7, 14, 21, elapsed, dayCount])]
    .sort((a, b) => a - b)
    .filter(
      (day) =>
        day > 0 &&
        (day === elapsed ||
          day === dayCount ||
          (day < dayCount - 2 && (!elapsed || Math.abs(day - elapsed) >= 3))),
    )
  const categories = (budget?.categories ?? []).map((category) => ({
    ...category,
    spentRatio: percent(BigInt(category.spentKopecks), BigInt(category.limitKopecks)),
  }))

  return {
    name: monthName.format(new Date(current.startDate + 'T00:00:00Z')),
    dayCount,
    elapsed,
    ticks,
    actual,
    target,
    spent,
    limit,
    remaining: limit === null ? null : limit - spent,
    spentRatio: limit === null ? 0 : percent(spent, limit),
    isOverPace: limit !== null && limit > 0n && spent * BigInt(dayCount) > limit * BigInt(elapsed),
    recorded: runningTotal,
    categories,
  }
})

function money(amount: bigint) {
  return formatKopecks(amount.toString())
}
</script>

<template>
  <main class="analytics budgets">
    <PeriodNavigation
      v-if="state.status !== 'telegram-required'"
      :has-previous="!!selectedMonth"
      :has-next="!!selectedMonth"
      :pending="pending === 'previous' || pending === 'next' ? pending : undefined"
      :disabled="!!pending"
      previous-label="Предыдущий месяц"
      next-label="Следующий месяц"
      @previous="shiftMonth(-1)"
      @next="shiftMonth(1)"
    >
      <template v-if="selectedMonthLabel">{{ selectedMonthLabel }}</template>
      <UiSkeleton v-else-if="state.status === 'loading'" class="range-placeholder" />
    </PeriodNavigation>

    <p v-if="state.status === 'telegram-required'" role="status">Откройте аналитику из меню бота</p>
    <div v-else-if="state.status === 'error' || pending === 'retry'">
      <p role="alert">Не удалось загрузить бюджеты</p>
      <UiAsyncButton class="retry" :loading="pending === 'retry'" @click="run('retry', refresh)">
        Повторить
      </UiAsyncButton>
    </div>
    <template v-else-if="details">
      <section aria-labelledby="month-budget-heading">
        <h2 id="month-budget-heading">Бюджет на {{ details.name }}</h2>
        <div class="summary">
          <p class="amounts">
            <strong :class="{ over: details.remaining !== null && details.remaining < 0n }">
              {{ money(details.spent) }}
            </strong>
            <span v-if="details.limit !== null">из {{ money(details.limit) }}</span>
            <span v-else>потрачено</span>
          </p>
          <div
            v-if="details.remaining !== null"
            class="track"
            :class="{ 'track-below-limit': details.remaining > 0n }"
            aria-hidden="true"
          >
            <span :style="{ width: Math.min(100, details.spentRatio * 100) + '%' }" />
          </div>
          <p v-if="details.remaining === null" class="muted">Общий лимит не задан</p>
          <p v-else-if="details.remaining < 0n" class="over">
            Превышение на {{ money(-details.remaining) }}
          </p>
          <p v-else-if="details.remaining === 0n">Лимит достигнут</p>
          <p v-else>Осталось {{ money(details.remaining) }}</p>
        </div>

        <h3 class="chart-heading">Темп расходов</h3>
        <div class="legend">
          <span><i aria-hidden="true" />Накопленные расходы</span>
          <span v-if="details.limit !== null"
            ><i class="dashed" aria-hidden="true" />Равномерный темп</span
          >
        </div>
        <VisXYContainer
          class="chart"
          :height="chartHeight"
          :duration="0"
          :x-domain="[0, details.dayCount]"
          :y-domain="[0, undefined]"
          aria-hidden="true"
        >
          <VisAxis type="x" :grid-line="false" :tick-values="details.ticks" />
          <VisAxis type="y" :num-ticks="5" :tick-format="compact.format" />
          <VisArea :data="details.actual" :x="x" :y="y" color="var(--expense)" :opacity="0.18" />
          <VisLine
            v-if="details.target.length"
            :data="details.target"
            :x="x"
            :y="y"
            color="var(--muted)"
            :line-dash-array="[5, 4]"
          />
          <VisLine :data="details.actual" :x="x" :y="y" color="var(--expense)" :line-width="2.5" />
          <VisScatter
            v-if="details.elapsed"
            :data="details.actual.slice(-1)"
            :x="x"
            :y="y"
            color="var(--expense)"
            :size="7"
          />
        </VisXYContainer>
        <p class="chart-total">
          <span v-if="details.elapsed">Расходы на {{ details.elapsed }}-е число</span>
          <span v-else>Расходы за месяц</span>
          <strong>{{ money(details.recorded) }}</strong>
        </p>

        <dl class="metrics">
          <div v-if="details.limit !== null">
            <dt>Потрачено от лимита</dt>
            <dd :class="{ over: details.isOverPace }">
              {{ percentFormat.format(details.spentRatio) }}
            </dd>
          </div>
          <div>
            <dt>Прошло дней месяца</dt>
            <dd>{{ percentFormat.format(details.elapsed / details.dayCount) }}</dd>
          </div>
        </dl>
      </section>

      <section class="categories" aria-labelledby="budget-categories-heading">
        <h2 id="budget-categories-heading">Расходы по бюджетам</h2>
        <ul v-if="details.categories.length">
          <li v-for="category in details.categories" :key="category.id">
            <div class="category-row">
              <strong>{{ category.name }}</strong>
              <span class="category-amount">
                <span
                  :class="{ over: BigInt(category.spentKopecks) > BigInt(category.limitKopecks) }"
                >
                  {{ formatKopecksAmount(category.spentKopecks) }}
                </span>
                <span class="category-limit">из {{ formatKopecks(category.limitKopecks) }}</span>
              </span>
            </div>
            <div
              class="track"
              :class="{ 'track-below-limit': category.spentRatio < 1 }"
              aria-hidden="true"
            >
              <span :style="{ width: Math.min(100, category.spentRatio * 100) + '%' }" />
            </div>
          </li>
        </ul>
        <p v-else class="muted">Лимиты по категориям пока не заданы</p>
      </section>
    </template>
    <AnalyticsLoading v-else label="Загружаем бюджеты…">
      <section>
        <h2>Бюджет на месяц</h2>
        <div class="summary">
          <div class="amounts amounts-placeholder">
            <UiSkeleton class="amount-placeholder" />
            <UiSkeleton class="line-placeholder" />
          </div>
          <UiSkeleton class="track" />
          <div class="text-placeholder"><UiSkeleton class="line-placeholder" /></div>
        </div>

        <h3 class="chart-heading">Темп расходов</h3>
        <div class="legend loading-legend">
          <UiSkeleton class="line-placeholder" />
          <UiSkeleton class="line-placeholder" />
        </div>
        <UiSkeleton class="chart" :style="{ height: chartHeight + 'px' }" />
        <div class="chart-total text-placeholder">
          <UiSkeleton class="line-placeholder" />
          <UiSkeleton class="line-placeholder" />
        </div>

        <dl class="metrics">
          <div v-for="label in ['Потрачено от лимита', 'Прошло дней месяца']" :key="label">
            <dt>{{ label }}</dt>
            <dd class="text-placeholder"><UiSkeleton class="metric-placeholder" /></dd>
          </div>
        </dl>
      </section>

      <section class="categories">
        <h2>Расходы по бюджетам</h2>
        <ul>
          <li v-for="row in 3" :key="row">
            <div class="category-row category-row-placeholder">
              <UiSkeleton class="line-placeholder" />
              <UiSkeleton class="line-placeholder category-amount" />
            </div>
            <UiSkeleton class="track" />
          </li>
        </ul>
      </section>
    </AnalyticsLoading>
  </main>
</template>

<style scoped>
.retry {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  color: var(--accent);
  font-weight: 650;
}
section {
  margin-top: 20px;
}
.muted {
  color: var(--muted);
  font-size: 14px;
}
.summary {
  margin-top: 12px;
  padding: 14px;
  border-radius: 14px;
  background: var(--control);
}
.amounts {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 2px 8px;
  margin-bottom: 6px;
}
.amounts strong {
  font-size: clamp(25px, 7vw, 34px);
  overflow-wrap: anywhere;
}
.amounts span {
  font-weight: 650;
}
.track {
  background: var(--track);
  height: 8px;
  border-radius: var(--radius-pill);
  overflow: hidden;
}
.track span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--expense);
}
.track-below-limit span {
  background: var(--accent);
}
.summary .track {
  height: 10px;
  margin: 6px 0 8px;
}
.over {
  color: var(--summary-deficit);
  font-weight: 650;
}
.chart-heading {
  margin: 16px 0 6px;
  font-size: 16px;
}
.legend {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 4px 12px;
  font-size: 13px;
}
.legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.legend i {
  width: 16px;
  border-top: 3px solid var(--expense);
}
.legend .dashed {
  border-top: 2px dashed var(--muted);
}
.chart {
  margin-top: 7px;
  --vis-axis-tick-label-color: var(--muted);
  --vis-axis-grid-color: var(--line);
  --vis-axis-domain-line-color: var(--line);
}
.chart-total {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 4px 10px;
  font-size: 14px;
}
.metrics {
  display: grid;
  grid-auto-columns: minmax(0, 1fr);
  grid-auto-flow: column;
  gap: 10px;
  margin-top: 14px;
}
.metrics div {
  border-radius: 12px;
  background: var(--control);
  padding: 10px 12px;
}
.metrics dt {
  color: var(--muted);
  font-size: 13px;
}
.metrics dd {
  font-size: 28px;
  font-weight: 750;
}
.categories {
  padding-top: 14px;
}
.categories ul {
  list-style: none;
  padding: 0;
  margin: 10px 0 0;
}
.categories li + li {
  margin-top: 10px;
}
.category-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) fit-content(75%);
  align-items: baseline;
  gap: 8px;
  margin-bottom: 4px;
  border-bottom: 0;
}
.category-row strong {
  overflow-wrap: anywhere;
}
.category-amount {
  text-align: right;
  overflow-wrap: anywhere;
}
.category-limit {
  margin-inline-start: 4px;
  font-size: 0.9em;
}

.text-placeholder,
.loading-legend {
  display: flex;
  align-items: center;
  min-height: 1lh;
}

.amounts-placeholder {
  align-items: center;
  min-height: 1lh;
  font-size: clamp(25px, 7vw, 34px);
}

.amount-placeholder {
  width: 138px;
  height: 1em;
}

.line-placeholder {
  width: 90px;
  height: 16px;
}

.metric-placeholder {
  width: 64px;
  height: 1em;
}

.category-row-placeholder {
  align-items: center;
  min-height: 1lh;
}
</style>
