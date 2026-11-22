<script setup lang="ts">
import { CalendarDays, ChevronLeft, ChevronRight, X } from '@lucide/vue'
import {
  CalendarDate,
  endOfMonth,
  parseDate,
  startOfMonth,
  startOfWeek,
  today,
} from '@internationalized/date'
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
  RadioGroupItem,
  RadioGroupRoot,
  RangeCalendarCell,
  RangeCalendarCellTrigger,
  RangeCalendarGrid,
  RangeCalendarGridBody,
  RangeCalendarGridHead,
  RangeCalendarGridRow,
  RangeCalendarHeadCell,
  RangeCalendarHeader,
  RangeCalendarHeading,
  RangeCalendarNext,
  RangeCalendarPrev,
  RangeCalendarRoot,
  TabsContent,
  TabsList,
  TabsRoot,
  TabsTrigger,
  type DateRange,
} from 'reka-ui'
import type { CustomPeriod, CustomPeriodMode } from '#shared/types/analytics'
import { formatDateRange } from '~/utils/analytics-format'

const props = defineProps<{ selection?: CustomPeriod; timeZone: string }>()
const emit = defineEmits<{ apply: [selection: CustomPeriod] }>()

const modes = [
  { value: 'month', label: 'Месяц' },
  { value: 'week', label: 'Неделя' },
  { value: 'range', label: 'Диапазон' },
] as const

const locale = 'ru-RU'
const minDate = new CalendarDate(1, 1, 1)
const maxRangeDays = 366
const monthName = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' })
const monthHeading = new Intl.DateTimeFormat(locale, {
  month: 'long',
  timeZone: 'UTC',
})

const open = ref(false)
const sheetFooter = useTemplateRef('sheetFooter')
const mode = ref<CustomPeriodMode>('range')
const maxDate = shallowRef(today(props.timeZone))
const year = ref(maxDate.value.year)
const weekPage = shallowRef(startOfMonth(maxDate.value))
const monthSelection = ref('')
const weekSelection = ref('')
const range = shallowRef<DateRange | null>(null)
const rangePage = shallowRef(maxDate.value)

watch(
  sheetFooter,
  (footer, _, onCleanup) => {
    const sheet = footer?.parentElement
    const tabs = sheet?.querySelector('.sheet-tabs')
    if (!footer || !sheet || !tabs) return

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let height = sheet.getBoundingClientRect().height
    let resizeAnimation: Animation | undefined
    const observer = new ResizeObserver(() => {
      if (!open.value) return
      const from =
        resizeAnimation?.playState === 'running' ? sheet.getBoundingClientRect().height : height
      resizeAnimation?.cancel()
      height = sheet.getBoundingClientRect().height
      if (motion.matches || Math.abs(height - from) < 1) return

      resizeAnimation = sheet.animate([{ height: `${from}px` }, { height: `${height}px` }], {
        duration: 240,
        easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      })
    })

    observer.observe(tabs)
    observer.observe(footer)
    onCleanup(() => {
      observer.disconnect()
      resizeAnimation?.cancel()
    })
  },
  { flush: 'post' },
)

function earlier(date: CalendarDate, limit: CalendarDate) {
  return date.compare(limit) <= 0 ? date : limit
}

const months = computed(() =>
  Array.from({ length: 12 }, (_, index) => {
    const date = new CalendarDate(year.value, index + 1, 1)
    return {
      value: date.toString(),
      label: monthName.format(date.toDate('UTC')).replace(/\.$/, ''),
      disabled: date.compare(maxDate.value) > 0,
    }
  }),
)

const weeks = computed(() => {
  const options = []
  const last = earlier(endOfMonth(weekPage.value), maxDate.value)
  for (
    let start = startOfWeek(weekPage.value, locale);
    start.compare(last) <= 0;
    start = start.add({ weeks: 1 })
  ) {
    const end = earlier(start.add({ days: 6 }), maxDate.value)
    options.push({
      value: start.toString(),
      label: formatDateRange(start.toString(), end.toString()),
    })
  }
  return options
})

const dates = computed(() => {
  if (mode.value === 'range') return range.value
  if (mode.value === 'month') {
    const start = parseDate(monthSelection.value)
    return { start, end: earlier(endOfMonth(start), maxDate.value) }
  }
  const start = parseDate(weekSelection.value)
  return { start, end: earlier(start.add({ days: 6 }), maxDate.value) }
})

const selectedRange = computed(() => {
  const { start, end } = dates.value ?? {}
  return start && end ? { startDate: start.toString(), endDate: end.toString() } : undefined
})

const tooLong = computed(() => {
  const { startDate, endDate } = selectedRange.value ?? {}
  return (
    !!startDate &&
    !!endDate &&
    Date.parse(endDate) - Date.parse(startDate) >= maxRangeDays * 86_400_000
  )
})

function setOpen(value: boolean) {
  if (value) {
    const active = props.selection
    const now = today(props.timeZone)
    const start = active ? parseDate(active.startDate) : now
    maxDate.value = now
    mode.value = active?.mode ?? 'range'
    year.value = start.year
    monthSelection.value = startOfMonth(start).toString()
    weekPage.value = startOfMonth(active?.mode === 'week' ? parseDate(active.endDate) : start)
    weekSelection.value = startOfWeek(start, locale).toString()
    rangePage.value = start
    range.value = active ? { start, end: parseDate(active.endDate) } : null
  }
  open.value = value
}

function apply() {
  if (!selectedRange.value || tooLong.value) return
  emit('apply', { period: 'custom', mode: mode.value, ...selectedRange.value })
  open.value = false
}
</script>

<template>
  <DialogRoot :open="open" @update:open="setOpen">
    <DialogTrigger
      class="period-dialog-trigger"
      :class="{ 'period-dialog-selected': selection }"
      aria-label="Выбрать период"
    >
      <CalendarDays :size="22" aria-hidden="true" />
    </DialogTrigger>

    <DialogPortal>
      <DialogOverlay class="period-overlay" />
      <DialogContent class="period-sheet">
        <div class="sheet-handle" aria-hidden="true" />
        <header class="sheet-header">
          <DialogTitle class="sheet-title">Выбрать период</DialogTitle>
          <DialogDescription class="sr-only">
            Выберите календарный месяц, неделю или даты начала и конца периода.
          </DialogDescription>
          <DialogClose class="sheet-close" aria-label="Закрыть">
            <X :size="24" aria-hidden="true" />
          </DialogClose>
        </header>

        <TabsRoot v-model="mode" class="sheet-tabs">
          <TabsList class="period-control" aria-label="Тип периода">
            <TabsTrigger
              v-for="item in modes"
              :key="item.value"
              class="period-option"
              :value="item.value"
              >{{ item.label }}</TabsTrigger
            >
          </TabsList>

          <TabsContent value="month" class="sheet-panel">
            <div class="sheet-navigation">
              <button
                class="sheet-arrow"
                aria-label="Предыдущий год"
                type="button"
                :disabled="year === minDate.year"
                @click="year--"
              >
                <ChevronLeft :size="20" aria-hidden="true" />
              </button>
              <p aria-live="polite">{{ year }}</p>
              <button
                class="sheet-arrow"
                aria-label="Следующий год"
                type="button"
                :disabled="year >= maxDate.year"
                @click="year++"
              >
                <ChevronRight :size="20" aria-hidden="true" />
              </button>
            </div>
            <RadioGroupRoot v-model="monthSelection" class="sheet-months" aria-label="Месяц">
              <RadioGroupItem
                v-for="month in months"
                :key="month.value"
                :value="month.value"
                :disabled="month.disabled"
                class="sheet-choice"
                >{{ month.label }}</RadioGroupItem
              >
            </RadioGroupRoot>
          </TabsContent>

          <TabsContent value="week" class="sheet-panel">
            <div class="sheet-navigation">
              <button
                class="sheet-arrow"
                aria-label="Предыдущий месяц"
                type="button"
                :disabled="weekPage.compare(minDate) <= 0"
                @click="weekPage = weekPage.subtract({ months: 1 })"
              >
                <ChevronLeft :size="20" aria-hidden="true" />
              </button>
              <p aria-live="polite">
                {{ monthHeading.format(weekPage.toDate('UTC')) }} {{ weekPage.year }}
              </p>
              <button
                class="sheet-arrow"
                aria-label="Следующий месяц"
                type="button"
                :disabled="weekPage.compare(startOfMonth(maxDate)) >= 0"
                @click="weekPage = weekPage.add({ months: 1 })"
              >
                <ChevronRight :size="20" aria-hidden="true" />
              </button>
            </div>
            <RadioGroupRoot v-model="weekSelection" class="sheet-weeks" aria-label="Неделя">
              <RadioGroupItem
                v-for="week in weeks"
                :key="week.value"
                :value="week.value"
                class="sheet-choice"
                >{{ week.label }}</RadioGroupItem
              >
            </RadioGroupRoot>
          </TabsContent>

          <TabsContent value="range" class="sheet-panel">
            <RangeCalendarRoot
              v-slot="{ date, grid, weekDays }"
              v-model="range"
              :default-placeholder="rangePage"
              :min-value="minDate"
              :max-value="maxDate"
              :locale="locale"
              :week-starts-on="1"
              weekday-format="short"
              calendar-label="Диапазон дат"
              prevent-deselect
            >
              <RangeCalendarHeader class="sheet-navigation">
                <RangeCalendarPrev class="sheet-arrow" aria-label="Предыдущий месяц">
                  <ChevronLeft :size="20" aria-hidden="true" />
                </RangeCalendarPrev>
                <RangeCalendarHeading class="sheet-calendar-heading">
                  {{ monthHeading.format(date.toDate('UTC')) }} {{ date.year }}
                </RangeCalendarHeading>
                <RangeCalendarNext class="sheet-arrow" aria-label="Следующий месяц">
                  <ChevronRight :size="20" aria-hidden="true" />
                </RangeCalendarNext>
              </RangeCalendarHeader>
              <RangeCalendarGrid
                v-for="month in grid"
                :key="month.value.toString()"
                class="sheet-calendar"
              >
                <RangeCalendarGridHead>
                  <RangeCalendarGridRow>
                    <RangeCalendarHeadCell v-for="day in weekDays" :key="day">{{
                      day
                    }}</RangeCalendarHeadCell>
                  </RangeCalendarGridRow>
                </RangeCalendarGridHead>
                <RangeCalendarGridBody>
                  <RangeCalendarGridRow v-for="(week, index) in month.rows" :key="index">
                    <RangeCalendarCell v-for="day in week" :key="day.toString()" :date="day">
                      <RangeCalendarCellTrigger class="sheet-day" :day="day" :month="month.value" />
                    </RangeCalendarCell>
                  </RangeCalendarGridRow>
                </RangeCalendarGridBody>
              </RangeCalendarGrid>
            </RangeCalendarRoot>
          </TabsContent>
        </TabsRoot>

        <footer ref="sheetFooter" class="sheet-footer">
          <p v-if="tooLong" class="sheet-range-error" role="alert">
            Выберите не больше {{ maxRangeDays }} дней
          </p>
          <p v-else aria-live="polite">
            <template v-if="selectedRange">
              {{ formatDateRange(selectedRange.startDate, selectedRange.endDate) }}
            </template>
            <template v-else>{{
              range?.start ? 'Выберите дату окончания' : 'Выберите дату начала'
            }}</template>
          </p>
          <button
            class="sheet-apply"
            type="button"
            :disabled="!selectedRange || tooLong"
            @click="apply"
          >
            Применить
          </button>
        </footer>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style scoped>
.period-dialog-trigger,
.sheet-close,
.sheet-arrow {
  display: grid;
  place-items: center;
  border-radius: var(--radius-pill);
  color: var(--muted);
}

.period-dialog-trigger,
.sheet-arrow {
  background: var(--control);
}

.period-dialog-trigger {
  min-height: 44px;
  color: var(--accent);
}

.period-dialog-selected {
  background: var(--accent-surface);
}

.period-overlay {
  position: fixed;
  z-index: 5;
  inset: 0;
  background: rgb(0 0 0 / 54%);
}

.period-sheet {
  position: fixed;
  z-index: 6;
  inset: auto 0 0;
  display: flex;
  flex-direction: column;
  width: min(100%, 480px);
  max-height: 100dvh;
  margin-inline: auto;
  padding: 12px max(16px, env(safe-area-inset-right))
    calc(
      24px +
        max(
          env(safe-area-inset-bottom, 0px),
          var(--tg-safe-area-inset-bottom, 0px) + var(--tg-content-safe-area-inset-bottom, 0px)
        )
    )
    max(16px, env(safe-area-inset-left));
  overflow-y: auto;
  overscroll-behavior: contain;
  border-radius: 32px 32px 0 0;
  background: color-mix(in srgb, var(--background) 55%, var(--control));
  color: var(--text);
}

@media (prefers-reduced-motion: no-preference) {
  .period-sheet[data-state='open'] {
    animation: period-sheet-enter 280ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }

  .period-sheet[data-state='closed'] {
    animation: period-sheet-exit 220ms ease-in both;
  }

  .period-overlay[data-state='open'] {
    animation: period-overlay-enter 280ms ease-out both;
  }

  .period-overlay[data-state='closed'] {
    animation: period-overlay-exit 220ms ease-in both;
  }

  @keyframes period-sheet-enter {
    from {
      transform: translateY(100%);
    }
    to {
      transform: translateY(0);
    }
  }

  @keyframes period-sheet-exit {
    from {
      transform: translateY(0);
    }
    to {
      transform: translateY(100%);
    }
  }

  @keyframes period-overlay-enter {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @keyframes period-overlay-exit {
    from {
      opacity: 1;
    }
    to {
      opacity: 0;
    }
  }
}

.sheet-handle {
  flex: none;
  align-self: center;
  width: 44px;
  height: 5px;
  margin-bottom: 12px;
  border-radius: var(--radius-pill);
  background: var(--line);
}

.sheet-header,
.sheet-navigation {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.sheet-header {
  margin-bottom: 10px;
}

.sheet-title {
  font-size: 23px;
}

.sheet-close,
.sheet-arrow {
  flex: 0 0 44px;
  width: 44px;
  height: 44px;
}

.sheet-arrow:disabled,
.sheet-choice:disabled {
  opacity: 0.45;
  cursor: default;
}

.sheet-panel {
  margin-top: 13px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}

.sheet-navigation {
  min-height: 44px;
  margin-bottom: 6px;
  font-size: 18px;
  font-weight: 700;
  text-align: center;
  text-transform: capitalize;
}

.sheet-calendar-heading {
  font: inherit;
}

.sheet-calendar {
  width: 100%;
  table-layout: fixed;
  border-spacing: 0 2px;
  text-align: center;
}

.sheet-calendar th {
  height: 36px;
  color: var(--muted);
  font-size: 13px;
  font-weight: 650;
  text-transform: uppercase;
}

.sheet-calendar td {
  padding: 0;
}

.sheet-day {
  display: grid;
  place-items: center;
  min-height: 40px;
  font-weight: 600;
  cursor: pointer;
}

.sheet-day[data-outside-view] {
  visibility: hidden;
}

.sheet-day[data-disabled] {
  color: var(--muted);
  opacity: 0.55;
  cursor: default;
}

.sheet-day:is([data-selected], [data-highlighted]) {
  background: var(--accent-surface);
}

:where(.sheet-calendar td:first-child, .sheet-calendar td:has(> .sheet-day[data-outside-view]) + td)
  .sheet-day {
  border-start-start-radius: 20px;
  border-end-start-radius: 20px;
}

:where(.sheet-calendar td:last-child, .sheet-calendar td:has(+ td > .sheet-day[data-outside-view]))
  .sheet-day {
  border-start-end-radius: 20px;
  border-end-end-radius: 20px;
}

.sheet-day:is([data-selection-start], [data-selection-end]) {
  border-radius: var(--radius-pill);
  background: var(--accent);
  color: var(--background);
  font-weight: 750;
}

.sheet-day:focus-visible {
  border-radius: var(--radius-pill);
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.sheet-day:is([data-selection-start], [data-selection-end]):focus-visible {
  outline-color: var(--background);
}

.sheet-months,
.sheet-weeks {
  display: grid;
  gap: 6px;
}

.sheet-months {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.sheet-months .sheet-choice {
  text-transform: capitalize;
}

.sheet-choice {
  min-height: 44px;
  padding-inline: 8px;
  border-radius: var(--radius-pill);
  background: var(--control);
  font-weight: 650;
}

.sheet-choice[data-state='checked'] {
  background: var(--accent-surface);
  color: var(--accent);
}

.sheet-footer {
  flex: none;
  padding-top: 18px;
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-weight: 650;
}

.sheet-tabs {
  flex: none;
  margin-bottom: 16px;
}

.sheet-range-error {
  color: var(--expense);
}

.sheet-apply {
  width: 100%;
  min-height: 50px;
  margin-top: 12px;
  border-radius: var(--radius-pill);
  background: var(--accent);
  color: var(--background);
  font-size: 17px;
  font-weight: 750;
}

.sheet-apply:disabled {
  background: var(--control);
  color: var(--muted);
  cursor: default;
}

.sheet-apply:focus-visible {
  outline-color: var(--background);
}
</style>
