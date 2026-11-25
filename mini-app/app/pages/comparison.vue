<script setup lang="ts">
import VisAxis from '@unovis/vue/components/axis'
import VisLine from '@unovis/vue/components/line'
import VisScatter from '@unovis/vue/components/scatter'
import VisXYContainer from '@unovis/vue/containers/xy-container'
import UiSegmentedRadioGroup from '~/components/ui/UiSegmentedRadioGroup.vue'
import { formatKopecks } from '~/utils/analytics-format'

defineOptions({ name: 'ExpenseComparisonPage' })
definePageMeta({ scrollToTop: false })
useHead({ title: 'Сравнение расходов' })

const { comparison, status, load } = useExpenseComparison()
const { pending, run } = usePendingAction<'retry'>()
const mode = ref<'daily' | 'total'>('total')
const modeOptions = [
  { value: 'total', label: 'Накопительно' },
  { value: 'daily', label: 'По дням' },
] as const
const chartHeight = 184
const compact = new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 })
const initData = useTelegramWebApp(refresh)

function refresh(background = false) {
  return load(initData, background)
}

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
    <p v-if="status === 'telegram-required'" role="status">Откройте аналитику из меню бота</p>
    <div v-else-if="status === 'error' || pending === 'retry'">
      <p role="alert">Не удалось загрузить сравнение</p>
      <UiAsyncButton class="retry" :loading="pending === 'retry'" @click="run('retry', refresh)">
        Повторить
      </UiAsyncButton>
    </div>
    <template v-else-if="comparison">
      <ExpenseComparisonSummary :comparison="comparison" :status="status" />
      <section class="pace-section" aria-labelledby="pace-heading">
        <div class="pace-header">
          <h2 id="pace-heading">Расходы</h2>
          <UiSegmentedRadioGroup
            v-model="mode"
            :options="modeOptions"
            class="mode period-control-compact"
            aria-label="Вид графика"
          />
        </div>
        <VisXYContainer
          class="pace-chart"
          :key="mode"
          :data="comparison.rows"
          :height="chartHeight"
          :duration="0"
          :x-domain="[1, Math.max(2, comparison.rows.length)]"
          :y-domain="[0, undefined]"
          role="img"
          :aria-label="`Темп расходов: ${comparison.currentMonth} и ${comparison.previousMonth}`"
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
      </section>

      <section class="comparison-card" aria-labelledby="category-delta-heading">
        <h2 id="category-delta-heading">Что изменилось по категориям</h2>
        <template v-if="comparison.categories.length">
          <div class="contribution-bar" aria-hidden="true">
            <span
              v-for="category in comparison.segments"
              :key="category.id ?? ''"
              :class="category.amount > 0n ? 'increase' : 'decrease'"
              :style="{ flexGrow: Math.abs(Number(category.amount)) }"
            />
          </div>
          <dl class="contribution-totals">
            <div class="increase">
              <dt>Рост расходов</dt>
              <dd>{{ formatKopecks(comparison.increaseTotal.toString(), true) }}</dd>
            </div>
            <div class="decrease">
              <dt>Снижение расходов</dt>
              <dd>{{ formatKopecks(comparison.decreaseTotal.toString(), true) }}</dd>
            </div>
          </dl>
          <ul class="changes">
            <li
              v-for="category in comparison.categories"
              :key="category.id ?? ''"
              :class="category.amount > 0n ? 'increase' : 'decrease'"
            >
              <span class="category-name">{{ category.name }}</span>
              <strong>{{ formatKopecks(category.amount.toString(), true) }}</strong>
            </li>
          </ul>
        </template>
        <p v-else class="range">Расходы по категориям не изменились</p>
      </section>
    </template>
    <AnalyticsLoading v-else label="Загружаем сравнение…">
      <ExpenseComparisonSummary status="loading" />
      <section class="pace-section">
        <div class="pace-header">
          <h2>Расходы</h2>
          <div class="mode period-control">
            <UiSkeleton v-for="tab in 2" :key="tab" class="mode-placeholder" />
          </div>
        </div>
        <UiSkeleton :style="{ height: chartHeight + 'px' }" />
      </section>
      <section class="comparison-card">
        <h2>Что изменилось по категориям</h2>
        <ul class="changes">
          <li v-for="row in 3" :key="row">
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
.range {
  color: var(--muted);
  font-size: 14px;
}
.comparison-card {
  min-width: 0;
  margin-top: 12px;
  padding: 14px;
  border-radius: var(--radius-card);
  background: var(--control);
}
.pace-section {
  min-width: 0;
  margin-top: 12px;
  padding: 14px;
}
.comparison-card h2,
.pace-section h2 {
  margin: 0;
}
.pace-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.mode {
  flex: 0 0 auto;
  width: 192px;
}
.pace-chart {
  --vis-axis-tick-label-color: var(--muted);
  --vis-axis-grid-color: var(--line);
  --vis-axis-domain-line-color: var(--line);
}
.mode-placeholder {
  height: 30px;
  border: 3px solid var(--control);
  border-radius: inherit;
}
.increase {
  --delta-text: var(--summary-deficit);
  --delta-bar: var(--expense);
}
.decrease {
  --delta-text: var(--summary-income);
  --delta-bar: var(--category-teal);
}
.contribution-totals dd,
.changes strong {
  color: var(--delta-text, var(--text));
}
.contribution-bar {
  display: flex;
  height: 20px;
  margin-top: 16px;
  overflow: hidden;
  border-radius: 6px;
}
.contribution-bar > span {
  flex-basis: 0;
  background: var(--delta-bar);
}
.contribution-bar > span + span {
  box-shadow: inset 1px 0 var(--control);
}
.contribution-totals {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin: 8px 0 16px;
  font-size: 13px;
}
.contribution-totals dt::before {
  content: '';
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-inline-end: 5px;
  border-radius: 2px;
  background: var(--delta-bar);
}
.contribution-totals dd {
  margin: 2px 0 0;
  font-weight: 700;
  overflow-wrap: anywhere;
}
.changes {
  list-style: none;
  padding: 0;
  margin: 10px 0 0;
}
.changes li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 46%);
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 6px 0;
  font-size: 14px;
}
.category-name,
.changes strong {
  overflow-wrap: anywhere;
}
.changes strong {
  text-align: right;
}
.line-placeholder {
  width: 84px;
  height: 1em;
}

.changes .line-placeholder:last-child {
  justify-self: end;
}
</style>
