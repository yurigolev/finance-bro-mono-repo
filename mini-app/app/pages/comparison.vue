<script setup lang="ts">
import VisAxis from '@unovis/vue/components/axis'
import VisLine from '@unovis/vue/components/line'
import VisScatter from '@unovis/vue/components/scatter'
import VisXYContainer from '@unovis/vue/containers/xy-container'
import type { AnalyticsOverview } from '#shared/types/analytics'
import UiSegmentedRadioGroup from '~/components/ui/UiSegmentedRadioGroup.vue'
import { formatKopecks } from '~/utils/analytics-format'

defineOptions({ name: 'ExpenseComparisonPage' })
definePageMeta({ scrollToTop: false })
useHead({ title: 'Сравнение расходов' })

const current = useAnalyticsOverview(ref({ period: 'current-month' } as const))
const previous = useAnalyticsOverview(ref({ period: 'previous-month' } as const))
const mode = ref<'daily' | 'total'>('total')
const modeOptions = [
  { value: 'daily', label: 'По дням' },
  { value: 'total', label: 'Накопительно' },
] as const
const chartHeight = 208
const initData = useTelegramWebApp(refresh)
const statuses = computed(() => [current.state.value.status, previous.state.value.status])
const monthFormat = new Intl.DateTimeFormat('ru-RU', { month: 'long', timeZone: 'UTC' })
const compact = new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 })

async function refresh(background = false) {
  await Promise.all([current.load(initData, background), previous.load(initData, background)])
}

function monthLabel(date: string) {
  const label = monthFormat.format(new Date(date + 'T00:00:00Z'))
  return label.charAt(0).toUpperCase() + label.slice(1)
}

const comparison = computed(() => {
  const first = current.state.value
  const second = previous.state.value
  if (first.status !== 'ready' || second.status !== 'ready') return
  const a = first.overview
  const b = second.overview
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
  const maximum = absolute(categories[0]?.amount ?? 1n)
  const currentMonth = monthLabel(a.startDate)
  const previousMonth = monthLabel(b.startDate)
  return {
    rows,
    total: currentTotal - previousTotal,
    currentTotal,
    previousTotal,
    currentMonth,
    previousMonth,
    currentPeriod: `${currentMonth} ${a.startDate.slice(0, 4)}`,
    previousPeriod: `${previousMonth} ${b.startDate.slice(0, 4)}`,
    categories: categories.map((category) => ({
      ...category,
      width: Number((absolute(category.amount) * 1000n) / maximum) / 20 + '%',
    })),
  }
})

type Row = NonNullable<typeof comparison.value>['rows'][number]
const currentColor = 'var(--expense)'
const previousColor = 'var(--muted)'
const x = (row: Row) => row.day
const currentY = (row: Row) =>
  Number(mode.value === 'total' ? row.currentTotal : row.currentDay) / 100
const previousY = (row: Row) =>
  Number(mode.value === 'total' ? row.previousTotal : row.previousDay) / 100
const dayTicks = computed(() => {
  const count = comparison.value?.rows.length ?? 1
  return [...new Set([1, ...[7, 14, 21].filter((day) => day <= count - 4), count])]
})
</script>

<template>
  <main class="analytics comparison">
    <h1>Сравнение расходов</h1>

    <p v-if="statuses.includes('telegram-required')" role="status">
      Откройте аналитику из меню бота
    </p>
    <div v-else-if="statuses.includes('error')">
      <p role="alert">Не удалось загрузить сравнение</p>
      <button class="retry" type="button" @click="refresh()">Повторить</button>
    </div>
    <template v-else-if="comparison">
      <p class="range comparison-period">
        {{ comparison.currentPeriod }} · {{ comparison.previousPeriod }}
      </p>
      <section aria-labelledby="pace-heading">
        <h2 id="pace-heading">Темп расходов</h2>
        <UiSegmentedRadioGroup
          v-model="mode"
          :options="modeOptions"
          class="mode"
          aria-label="Вид графика"
        />
        <VisXYContainer
          class="pace-chart"
          :key="mode"
          :data="comparison.rows"
          :height="chartHeight"
          :duration="0"
          :x-domain="[1, Math.max(2, comparison.rows.length)]"
          :y-domain="[0, undefined]"
          aria-hidden="true"
        >
          <VisAxis type="x" :tick-values="dayTicks" :grid-line="false" />
          <VisAxis type="y" :num-ticks="4" :tick-format="compact.format" />
          <VisLine :x="x" :y="currentY" :color="currentColor" />
          <VisLine :x="x" :y="previousY" :color="previousColor" :line-dash-array="[5, 4]" />
          <VisScatter
            v-if="comparison.rows.length === 1"
            :x="x"
            :y="[previousY, currentY]"
            :color="[previousColor, currentColor]"
          />
        </VisXYContainer>
        <dl class="legend">
          <div>
            <dt><span aria-hidden="true" />{{ comparison.currentMonth }}</dt>
            <dd>{{ formatKopecks(comparison.currentTotal.toString()) }}</dd>
          </div>
          <div>
            <dt><span class="dashed" aria-hidden="true" />{{ comparison.previousMonth }}</dt>
            <dd>{{ formatKopecks(comparison.previousTotal.toString()) }}</dd>
          </div>
        </dl>
        <details>
          <summary>Данные графика</summary>
          <table>
            <thead>
              <tr>
                <th scope="col">День</th>
                <th scope="col">{{ comparison.currentMonth }}</th>
                <th scope="col">{{ comparison.previousMonth }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in comparison.rows" :key="row.day">
                <th scope="row">{{ row.day }}</th>
                <td>
                  {{
                    formatKopecks((mode === 'total' ? row.currentTotal : row.currentDay).toString())
                  }}
                </td>
                <td>
                  {{
                    formatKopecks(
                      (mode === 'total' ? row.previousTotal : row.previousDay).toString(),
                    )
                  }}
                </td>
              </tr>
            </tbody>
          </table>
        </details>
      </section>

      <section class="category-delta" aria-labelledby="category-delta-heading">
        <h2 id="category-delta-heading">Что изменилось по категориям</h2>
        <p
          class="delta-total"
          :class="{ increase: comparison.total > 0n, decrease: comparison.total < 0n }"
        >
          {{ formatKopecks(comparison.total.toString(), true) }}
        </p>
        <p class="range">К тому же периоду прошлого месяца</p>
        <ul v-if="comparison.categories.length" class="changes">
          <li
            v-for="category in comparison.categories"
            :key="category.id ?? ''"
            :class="category.amount > 0n ? 'increase' : 'decrease'"
          >
            <span class="category-name">{{ category.name }}</span>
            <span class="change-plot" aria-hidden="true"
              ><span :style="{ width: category.width }"
            /></span>
            <strong>{{ formatKopecks(category.amount.toString(), true) }}</strong>
          </li>
        </ul>
        <p v-else class="range">Расходы по категориям не изменились</p>
      </section>
    </template>
    <AnalyticsLoading v-else label="Загружаем сравнение…">
      <div class="range comparison-period">
        <UiSkeleton class="comparison-period-placeholder" />
      </div>
      <section>
        <h2>Темп расходов</h2>
        <div class="mode period-control">
          <UiSkeleton v-for="tab in 2" :key="tab" class="mode-placeholder" />
        </div>
        <UiSkeleton :style="{ height: chartHeight + 'px' }" />
        <div class="legend">
          <div v-for="row in 2" :key="row" class="legend-row-placeholder">
            <UiSkeleton class="line-placeholder" />
            <UiSkeleton class="line-placeholder" />
          </div>
        </div>
        <div class="disclosure-placeholder"><UiSkeleton class="line-placeholder" /></div>
      </section>
      <section class="category-delta">
        <h2>Что изменилось по категориям</h2>
        <div class="delta-total delta-placeholder"><UiSkeleton class="line-placeholder" /></div>
        <p class="range">К тому же периоду прошлого месяца</p>
        <ul class="changes">
          <li v-for="row in 3" :key="row">
            <UiSkeleton class="line-placeholder" />
            <UiSkeleton class="line-placeholder" />
            <UiSkeleton class="line-placeholder" />
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
h1 {
  margin: 8px 0 4px;
  font-size: 30px;
  line-height: 1.12;
  letter-spacing: -0.03em;
}
.range {
  color: var(--muted);
  font-size: 14px;
}
section {
  margin-top: 22px;
}
.mode {
  margin: 12px 0 8px;
}
.pace-chart {
  --vis-axis-tick-label-color: var(--muted);
  --vis-axis-grid-color: var(--line);
  --vis-axis-domain-line-color: var(--line);
}
.legend {
  display: grid;
  gap: 5px;
}
.legend div,
.legend dt {
  display: flex;
  align-items: center;
  gap: 8px;
}
.legend div {
  justify-content: space-between;
}
.legend dt span {
  width: 22px;
  border-top: 3px solid var(--expense);
  border-radius: 3px;
}
.legend dt .dashed {
  border-top: 2px dashed var(--muted);
}
details {
  font-size: 14px;
  margin-top: 6px;
}
summary {
  cursor: pointer;
  color: var(--accent);
  padding: 9px 0;
}
table {
  width: 100%;
  border-collapse: collapse;
}
td,
th {
  padding: 5px 3px;
  text-align: right;
  border-bottom: 1px solid var(--line);
  overflow-wrap: anywhere;
}
th:first-child {
  text-align: left;
}
.category-delta {
  border-top: 1px solid var(--line);
  padding-top: 16px;
  margin-top: 12px;
}
.delta-total {
  font-size: 32px;
  font-weight: 750;
  margin-top: 5px;
}
.increase {
  --delta-text: var(--summary-deficit);
  --delta-bar: var(--expense);
}
.decrease {
  --delta-text: var(--category-teal);
  --delta-bar: var(--category-teal);
}
.delta-total,
.changes strong {
  color: var(--delta-text, var(--text));
}
.changes {
  list-style: none;
  padding: 0;
  margin: 10px 0 0;
}
.changes li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(48px, 1fr) minmax(80px, 30%);
  align-items: center;
  gap: 8px;
  min-height: 34px;
  font-size: 14px;
}
.category-name,
.changes strong {
  overflow-wrap: anywhere;
}
.changes strong {
  text-align: right;
}
.change-plot {
  position: relative;
  align-self: stretch;
}
.change-plot::before {
  content: '';
  position: absolute;
  height: 100%;
  left: 50%;
  border-left: 1px solid var(--line);
  opacity: 0.5;
}
.change-plot > span {
  position: absolute;
  top: 50%;
  height: 14px;
  min-width: 2px;
  max-width: 100%;
  translate: 0 -50%;
  background: var(--delta-bar);
  border-radius: 4px;
}
.increase .change-plot > span {
  left: 50%;
}
.decrease .change-plot > span {
  right: 50%;
}

.comparison-period {
  min-height: 1lh;
}

.comparison-period-placeholder {
  width: min(100%, 272px);
  height: 1em;
  align-self: center;
}

.comparison-period:has(.comparison-period-placeholder) {
  display: flex;
}

@media (max-width: 360px) {
  .comparison-period {
    min-height: 2lh;
  }
}

.mode-placeholder {
  height: 44px;
  border: 3px solid var(--control);
  border-radius: inherit;
}

.legend-row-placeholder {
  min-height: 1lh;
}

.line-placeholder {
  width: 84px;
  height: 1em;
}

.changes .line-placeholder:last-child {
  justify-self: end;
}

.disclosure-placeholder {
  display: flex;
  align-items: center;
  min-height: calc(1lh + 18px);
  margin-top: 6px;
  font-size: 14px;
}

.disclosure-placeholder .line-placeholder {
  width: 128px;
}

.delta-placeholder {
  display: flex;
  align-items: center;
  min-height: 1lh;
}

.delta-placeholder .line-placeholder {
  width: 136px;
}
</style>
