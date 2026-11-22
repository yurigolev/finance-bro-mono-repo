<script setup lang="ts">
import VisGroupedBar from '@unovis/vue/components/grouped-bar'
import VisXYContainer from '@unovis/vue/containers/xy-container'
import type { Day } from '#shared/types/analytics'
import ChartContainer from '~/components/ui/ChartContainer.vue'
import { formatDay, formatKopecks } from '~/utils/analytics-format'

const props = defineProps<{ days: Day[] }>()
const selectedDate = defineModel<string>({ required: true })
const emit = defineEmits<{ selectDay: [date: string] }>()

function selectDay(date: string) {
  selectedDate.value = date
  emit('selectDay', date)
}

const chartConfig = {
  income: { label: 'Доходы', color: 'var(--income)' },
  expense: { label: 'Расходы', color: 'var(--expense)' },
}
const series = ['income', 'expense'] as const

const chartDays = computed(() =>
  props.days.map((day) => ({
    income: Number(day.incomeKopecks) / 100,
    expense: Number(day.expenseKopecks) / 100,
  })),
)
type ChartDay = (typeof chartDays.value)[number]
const x = (_: ChartDay, index: number) => index + 0.5
const y = series.map((kind) => (day: ChartDay) => day[kind])
const colors = series.map((kind) => `var(--color-${kind})`)
const plotHeight = 139
const noSpacing = { top: 0, right: 0, bottom: 0, left: 0 }

const selectedDay = computed(() => props.days.find((day) => day.date === selectedDate.value))
const xDomain = computed<[number, number]>(() => [0, props.days.length])

const numberFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 })
const compactFormat = new Intl.NumberFormat('ru-RU', {
  notation: 'compact',
  maximumFractionDigits: 1,
})
const shortDateFormat = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})

const yTicks = computed(() => {
  const maximum = Math.max(1, ...chartDays.value.flatMap((day) => [day.income, day.expense]))
  const power = 10 ** Math.floor(Math.log10(maximum / 6))
  const step = ([1, 2, 2.5, 5, 10].find((value) => value * power >= maximum / 6) ?? 10) * power
  return Array.from({ length: Math.ceil(maximum / step) + 1 }, (_, index) => index * step)
})
const yDomain = computed<[number, number]>(() => [0, yTicks.value.at(-1)!])
const xTicks = computed(() => {
  const last = props.days.length - 1
  if (last > 30) return new Set([0, Math.round(last / 3), Math.round((last * 2) / 3), last])
  const intermediate =
    last < 7 ? [Math.floor(last / 2)] : [6, 13, 20].filter((day) => day <= last - 4)
  return new Set([0, ...intermediate, last])
})
const crossesMonth = computed(
  () => props.days[0]?.date.slice(0, 7) !== props.days.at(-1)?.date.slice(0, 7),
)

function axisDay(date: string) {
  return crossesMonth.value
    ? shortDateFormat.format(new Date(`${date}T00:00:00Z`))
    : Number(date.slice(-2))
}
</script>

<template>
  <ChartContainer :config="chartConfig" class="day-chart">
    <div class="legend" aria-hidden="true">
      <span v-for="kind in series" :key="kind" class="legend-item">
        <span class="series-dot" :class="kind" />{{ chartConfig[kind].label }}
      </span>
    </div>

    <div
      class="chart-frame"
      :style="{ '--day-count': days.length, '--plot-height': plotHeight + 'px' }"
    >
      <div class="plot-labels" aria-hidden="true">
        <span
          v-for="tick in yTicks"
          :key="tick"
          :style="{ bottom: `${(tick / yDomain[1]) * 100}%` }"
          >{{ tick >= 100_000 ? compactFormat.format(tick) : numberFormat.format(tick) }}</span
        >
      </div>
      <div class="plot">
        <div class="plot-grid" aria-hidden="true">
          <span
            v-for="tick in yTicks"
            :key="tick"
            :style="{ bottom: `${(tick / yDomain[1]) * 100}%` }"
          />
        </div>
        <VisXYContainer
          :data="chartDays"
          :height="plotHeight"
          :auto-margin="false"
          :margin="noSpacing"
          :bleed="noSpacing"
          :x-domain="xDomain"
          :y-domain="yDomain"
          :duration="0"
          class="plot-bars"
          aria-hidden="true"
        >
          <VisGroupedBar
            :x="x"
            :y="y"
            :color="colors"
            :data-step="1"
            :bar-min-height="0"
            :bar-padding="0.14"
            :group-padding="0.25"
            rounded-corners
          />
        </VisXYContainer>

        <div class="plot-days">
          <button
            v-for="day in days"
            :key="day.date"
            type="button"
            :aria-label="formatDay(day.date)"
            :aria-pressed="day.date === selectedDate"
            :title="formatDay(day.date)"
            :class="{ selected: day.date === selectedDate }"
            @click="selectDay(day.date)"
          />
        </div>
      </div>
      <div class="plot-dates" aria-hidden="true" :class="{ 'across-months': crossesMonth }">
        <span v-for="(day, index) in days" :key="day.date">
          <span v-if="xTicks.has(index)">{{ axisDay(day.date) }}</span>
        </span>
      </div>
    </div>

    <div v-if="selectedDay" class="selected-day" aria-live="polite">
      <time :datetime="selectedDay.date">{{ formatDay(selectedDay.date) }}</time>
      <span class="selected-day-amounts">
        <span v-for="kind in series" :key="kind" class="legend-item">
          <span class="sr-only">{{ chartConfig[kind].label }} </span>
          <span class="series-dot" :class="kind" aria-hidden="true" />
          <span>{{ formatKopecks(selectedDay[`${kind}Kopecks`]) }}</span>
        </span>
      </span>
    </div>
  </ChartContainer>
</template>
