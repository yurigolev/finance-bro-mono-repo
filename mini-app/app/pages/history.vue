<script setup lang="ts">
import {
  ArrowUpRight,
  Car,
  Coffee,
  Cross,
  Gift,
  GraduationCap,
  Hammer,
  House,
  Laptop,
  Plane,
  Plus,
  ReceiptText,
  Repeat,
  Shirt,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  TrendingUp,
  Wallet,
} from '@lucide/vue'
import { endOfMonth, parseDate } from '@internationalized/date'
import { useToastManager } from 'reka-ui'
import type { CustomPeriod } from '#shared/types/analytics'
import type { HistoryMonth, HistoryOperation } from '#shared/types/history'
import type { OperationKind } from '#shared/types/settings'
import { formatDay, formatKopecks, formatMonthRange } from '~/utils/analytics-format'

defineOptions({ name: 'HistoryPage' })
definePageMeta({ scrollToTop: false })
useHead({ title: 'История' })

const filters = [
  { value: 'all', label: 'Все' },
  { value: 'expense', label: 'Расходы' },
  { value: 'income', label: 'Доходы' },
] as const
const categoryIcons = new Map([
  ['groceries', { icon: ShoppingCart, color: 'var(--expense)' }],
  ['dining', { icon: Coffee, color: 'var(--category-gold)' }],
  ['transport', { icon: Car, color: 'var(--accent)' }],
  ['housing', { icon: House, color: 'var(--category-teal)' }],
  ['health', { icon: Cross, color: 'var(--category-purple)' }],
  ['shopping', { icon: ShoppingBag, color: 'var(--category-blue)' }],
  ['gifts', { icon: Gift, color: 'var(--expense)' }],
  ['travel', { icon: Plane, color: 'var(--accent)' }],
  ['subscriptions', { icon: Repeat, color: 'var(--category-slate)' }],
  ['clothing', { icon: Shirt, color: 'var(--category-purple)' }],
  ['electronics', { icon: Laptop, color: 'var(--category-blue)' }],
  ['beauty', { icon: Sparkles, color: 'var(--category-gold)' }],
  ['education', { icon: GraduationCap, color: 'var(--category-teal)' }],
  ['salary', { icon: Wallet, color: 'var(--summary-income)' }],
  ['projects', { icon: Hammer, color: 'var(--summary-income)' }],
  ['interest', { icon: TrendingUp, color: 'var(--summary-income)' }],
])
const fallbackIcons = {
  income: { icon: ArrowUpRight, color: 'var(--summary-income)' },
  expense: { icon: ReceiptText, color: 'var(--muted)' },
}
const filter = ref<OperationKind | 'all'>('all')
const month = ref('')
const history = shallowRef<HistoryMonth>()
const loading = ref(true)
const error = ref(false)
const expired = ref(false)
let request: AbortController | undefined

const { add: notify } = useToastManager()
const initData = useTelegramWebApp(refresh)
const visibleMonth = computed(() => month.value || history.value?.today.slice(0, 7))
const startDate = computed(() => visibleMonth.value && `${visibleMonth.value}-01`)
const selection = computed<CustomPeriod | undefined>(() => {
  if (!startDate.value || !history.value) return
  const end = endOfMonth(parseDate(startDate.value)).toString()
  return {
    period: 'custom',
    mode: 'month',
    startDate: startDate.value,
    endDate: end < history.value.today ? end : history.value.today,
  }
})
const groups = computed(() => {
  const days = new Map<string, HistoryOperation[]>()
  for (const operation of history.value?.operations ?? []) {
    if (filter.value !== 'all' && operation.kind !== filter.value) continue
    const day = days.get(operation.date)
    if (day) day.push(operation)
    else days.set(operation.date, [operation])
  }
  return [...days]
})
const yesterday = computed(() => {
  if (!history.value || history.value.today === '0001-01-01') return
  return parseDate(history.value.today).subtract({ days: 1 }).toString()
})

onDeactivated(() => {
  request?.abort()
  request = undefined
})

function groupLabel(date: string) {
  if (date === history.value?.today) return `Сегодня, ${formatDay(date)}`
  if (date === yesterday.value) return `Вчера, ${formatDay(date)}`
  return formatDay(date)
}

function categoryName(operation: HistoryOperation) {
  if (!operation.categoryName) return 'Без категории'
  return operation.categoryKey
    ? operation.categoryName.replace(/^\p{Extended_Pictographic}\uFE0F?\s+/u, '')
    : operation.categoryName
}

function categoryIcon(operation: HistoryOperation) {
  return categoryIcons.get(operation.categoryKey ?? '') ?? fallbackIcons[operation.kind]
}

function selectMonth(selected: string) {
  month.value = selected === history.value?.today.slice(0, 7) ? '' : selected
  void refresh()
}

function moveMonth(offset: number) {
  if (!startDate.value) return
  selectMonth(parseDate(startDate.value).add({ months: offset }).toString().slice(0, 7))
}

function sessionExpired() {
  expired.value = true
  history.value = undefined
}

async function refresh(background = false) {
  if (!initData || expired.value || (background && request)) return
  request?.abort()
  const current = new AbortController()
  request = current
  const query = month.value ? `?month=${month.value}` : ''
  const keepVisible = background && history.value?.month === visibleMonth.value && !!history.value
  loading.value = !keepVisible
  error.value = false

  try {
    const response = await fetch(`/api/transactions${query}`, {
      headers: { 'X-Telegram-Init-Data': initData },
      cache: 'no-store',
      redirect: 'error',
      signal: current.signal,
    })
    if (request !== current) return
    if (response.status === 401) {
      sessionExpired()
      return
    }
    if (!response.ok) throw new Error()
    const data: HistoryMonth = await response.json()
    if (request === current && !expired.value) history.value = data
  } catch {
    if (request === current && !keepVisible) error.value = true
  } finally {
    if (request === current) {
      request = undefined
      loading.value = false
    }
  }
}

function showSavedOperation(date: string, kind: OperationKind) {
  if (filter.value !== 'all' && filter.value !== kind) filter.value = 'all'
  selectMonth(date.slice(0, 7))
  notify({ title: 'Операция сохранена', status: 'success' })
}
</script>

<template>
  <main class="analytics history" aria-labelledby="history-title">
    <header class="history-header">
      <h1 id="history-title">История операций</h1>
      <HistoryEntryDialog
        v-if="initData && history && !expired"
        :init-data="initData"
        :today="history.today"
        :disabled="loading"
        @saved="showSavedOperation"
        @expired="sessionExpired"
      />
      <button v-else class="history-add-placeholder" type="button" disabled>
        <Plus :size="20" aria-hidden="true" /> Добавить
      </button>
    </header>

    <p v-if="!initData || expired" class="history-message" role="status">
      Откройте историю из меню бота
    </p>
    <template v-else>
      <div v-if="history && startDate" class="history-period">
        <PeriodNavigation
          previous-label="Предыдущий месяц"
          next-label="Следующий месяц"
          :has-previous="visibleMonth !== '0001-01'"
          :has-next="Boolean(visibleMonth && visibleMonth < history.today.slice(0, 7))"
          @previous="moveMonth(-1)"
          @next="moveMonth(1)"
        >
          {{ formatMonthRange(startDate, startDate) }} {{ startDate.slice(0, 4) }}
        </PeriodNavigation>
        <PeriodDialog
          month-only
          :selection="selection"
          :time-zone="history.timeZone"
          @apply="selectMonth($event.startDate.slice(0, 7))"
        />
      </div>
      <UiSegmentedRadioGroup
        v-if="history"
        v-model="filter"
        :options="filters"
        aria-label="Тип операций"
      />

      <div class="history-results" :aria-busy="loading">
        <p v-if="loading" class="history-message" role="status">Загружаем операции…</p>
        <div v-else-if="error" class="history-message">
          <p role="alert">Не удалось загрузить операции</p>
          <button class="history-retry" type="button" @click="refresh()">Повторить</button>
        </div>
        <p v-else-if="!groups.length" class="history-message" role="status">
          {{
            filter === 'expense'
              ? 'За этот месяц нет расходов'
              : filter === 'income'
                ? 'За этот месяц нет доходов'
                : 'За этот месяц нет операций'
          }}
        </p>

        <section
          v-for="[date, operations] in loading || error ? [] : groups"
          :key="date"
          class="history-day"
        >
          <h2>{{ groupLabel(date) }}</h2>
          <ul class="history-operations" role="list">
            <li v-for="operation in operations" :key="operation.id" class="history-operation">
              <div
                class="history-icon"
                :style="{ '--category-color': categoryIcon(operation).color }"
              >
                <component :is="categoryIcon(operation).icon" :size="23" aria-hidden="true" />
              </div>
              <div class="history-operation-copy">
                <p class="history-description">{{ operation.description }}</p>
                <p class="history-meta">
                  <template v-if="operation.time">{{ operation.time }} · </template
                  >{{ categoryName(operation) }}
                </p>
              </div>
              <p class="history-amount" :data-kind="operation.kind">
                {{
                  formatKopecks(
                    operation.kind === 'expense'
                      ? `-${operation.amountKopecks}`
                      : operation.amountKopecks,
                    true,
                  )
                }}
              </p>
            </li>
          </ul>
        </section>
      </div>
    </template>
  </main>
</template>

<style scoped>
.history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 3px 0 12px;
}

.history-header h1 {
  margin: 0;
  font-size: clamp(25px, 6.7vw, 30px);
  font-weight: 800;
  line-height: 1.12;
}

.history-add-placeholder {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 42px;
  padding-inline: 14px;
  border-radius: var(--radius-pill);
  background: var(--accent);
  color: var(--background);
  font-weight: 750;
  opacity: 0.5;
  cursor: default;
}

.history-period {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 44px;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.history-period :deep(.period-range) {
  margin: 0;
}

.history-results {
  margin-top: 22px;
}

.history-day + .history-day {
  margin-top: 20px;
}

.history-day h2 {
  margin-bottom: 7px;
  font-size: 18px;
  font-weight: 750;
}

.history-operations {
  margin: 0;
  padding: 0;
  list-style: none;
}

.history-operation {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  min-height: 61px;
  padding-block: 8px;
  border-bottom: 1px solid color-mix(in srgb, var(--line) 78%, transparent);
}

.history-icon {
  display: grid;
  place-items: center;
  aspect-ratio: 1;
  border-radius: 14px;
  background: color-mix(in srgb, var(--category-color) 20%, var(--background));
  color: var(--category-color);
}

.history-description {
  font-weight: 750;
  overflow-wrap: anywhere;
}

.history-meta {
  color: var(--muted);
  font-size: 13px;
  overflow-wrap: anywhere;
}

.history-amount {
  color: var(--summary-deficit);
  font-size: clamp(14px, 4.4vw, 18px);
  font-weight: 750;
  text-align: right;
  white-space: nowrap;
}

.history-amount[data-kind='income'] {
  color: var(--summary-income);
}

.history-message {
  padding-block: 18px;
  color: var(--muted);
  text-align: center;
}

.history-retry {
  min-height: 44px;
  padding-inline: 12px;
  color: var(--accent);
  font-weight: 700;
}

@media (max-width: 350px) {
  .history-operation {
    grid-template-columns: 36px minmax(0, 1fr) auto;
    gap: 8px;
  }

  .history-icon {
    border-radius: 12px;
  }
}
</style>
