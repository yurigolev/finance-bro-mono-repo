<script setup lang="ts">
import VisDonut, { VisDonutSelectors } from '@unovis/vue/components/donut'
import VisSingleContainer from '@unovis/vue/containers/single-container'
import type { AnalyticsCategory, CategoryKind } from '#shared/types/analytics'
import { formatKopecks } from '~/utils/analytics-format'

const props = defineProps<{
  categories: AnalyticsCategory[]
  kind: CategoryKind
  totalKopecks: string
  daily?: boolean
}>()
const selectedId = ref<string>()
const otherColors = [
  'var(--category-gold)',
  'var(--category-purple)',
  'var(--category-blue)',
  'var(--category-teal)',
  'var(--category-slate)',
]
const labels = {
  income: { empty: 'Нет доходов', day: 'Доходы за день', period: 'Всего доходов' },
  expense: { empty: 'Нет расходов', day: 'Расходы за день', period: 'Всего расходов' },
}
const shareFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 })
const donutSize = 192

const rows = computed(() => {
  const total = BigInt(props.totalKopecks)
  if (total === 0n) return []
  const colors = [
    `var(--${props.kind})`,
    props.kind === 'income' ? 'var(--expense)' : 'var(--income)',
    ...otherColors,
  ]
  const categories = [...props.categories].sort(
    (a, b) => Number(a.id === null) - Number(b.id === null),
  )
  return categories.map((category, index) => {
    const amount = BigInt(category.amountKopecks)
    const hundredths = (amount * 10_000n + total / 2n) / total
    return {
      ...category,
      id: category.id ?? 'uncategorized',
      value: Number(amount),
      color: category.id === null ? 'var(--category-gray)' : colors[index % colors.length]!,
      share:
        amount > 0n && hundredths === 0n
          ? '<0,01%'
          : `${shareFormat.format(Number(hundredths) / 100)}%`,
    }
  })
})

type CategoryRow = (typeof rows.value)[number]
const segmentValue = (row: CategoryRow) => row.value
const segmentColor = (row: CategoryRow) => row.color
const selectedRow = computed(() => rows.value.find((row) => row.id === selectedId.value))
const summaryLabel = computed(() => {
  const kindLabels = labels[props.kind]
  if (!rows.value.length) return kindLabels.empty
  return props.daily ? kindLabels.day : kindLabels.period
})
const selectionAttributes = computed(() => {
  const id = selectedId.value
  return {
    [VisDonutSelectors.segment]: {
      'data-expanded': ({ data }: { data: CategoryRow }) => data.id === id,
    },
  }
})

function toggleCategory(id: CategoryRow['id']) {
  selectedId.value = selectedId.value === id ? undefined : id
}

watch(rows, () => {
  if (!selectedRow.value) selectedId.value = undefined
})

const segmentEvents = {
  [VisDonutSelectors.segment]: {
    click: ({ data }: { data: CategoryRow }) => toggleCategory(data.id),
  },
}
const segmentAttributes = computed(() => ({
  [VisDonutSelectors.segment]: {
    ...selectionAttributes.value[VisDonutSelectors.segment],
    cursor: 'pointer',
    'data-category-segment': '',
  },
}))
</script>

<template>
  <div class="category-donut" :style="{ '--donut-size': `${donutSize}px` }">
    <VisSingleContainer :data="rows" :height="donutSize" :duration="0" aria-hidden="true">
      <VisDonut
        :value="segmentValue"
        :color="segmentColor"
        :arc-width="20"
        :show-background="!rows.length"
        :events="segmentEvents"
        :attributes="segmentAttributes"
      />
    </VisSingleContainer>
    <VisSingleContainer
      v-if="rows.length"
      :data="rows"
      :height="donutSize"
      :duration="0"
      class="category-donut-selection"
      aria-hidden="true"
    >
      <VisDonut
        :value="segmentValue"
        :color="segmentColor"
        :arc-width="20"
        :show-background="false"
        :attributes="selectionAttributes"
      />
    </VisSingleContainer>
    <dl class="category-total" :data-selected="!!selectedRow" aria-live="polite" aria-atomic="true">
      <dt>{{ selectedRow?.name ?? summaryLabel }}</dt>
      <dd>{{ formatKopecks(selectedRow?.amountKopecks ?? totalKopecks) }}</dd>
    </dl>
  </div>
  <ul v-if="rows.length" class="category-list" role="list">
    <li v-for="category in rows" :key="category.id" class="category-row">
      <button
        type="button"
        class="category-label"
        :style="{ '--category-color': category.color }"
        :aria-pressed="category.id === selectedId"
        @click="toggleCategory(category.id)"
      >
        <span class="category-name">
          <span class="series-dot category-swatch" aria-hidden="true" />
          <span>{{ category.name }}</span>
        </span>
        <span class="category-amount">{{ formatKopecks(category.amountKopecks) }}</span>
        <span class="category-share">{{ category.share }}</span>
      </button>
    </li>
  </ul>
</template>
