<script setup lang="ts">
import type { ExpenseComparisonStatus } from '~/composables/useExpenseComparison'
import { formatKopecks } from '~/utils/analytics-format'
import type { ExpenseComparison } from '~/utils/expense-comparison'

const props = defineProps<{
  comparison?: ExpenseComparison
  status: ExpenseComparisonStatus
}>()
const headingId = useId()
const tone = computed(() => {
  const total = props.comparison?.total ?? 0n
  if (total > 0n) return 'increase'
  if (total < 0n) return 'decrease'
})
</script>

<template>
  <section class="expense-summary" :class="tone" :aria-labelledby="headingId">
    <h2 :id="headingId">Разница в расходах</h2>
    <template v-if="comparison">
      <p class="amount">{{ formatKopecks(comparison.total.toString(), true) }}</p>
      <dl class="month-totals">
        <div>
          <dt>
            <span class="swatch" aria-hidden="true" />
            {{ comparison.currentMonth }}
          </dt>
          <dd>{{ formatKopecks(comparison.currentTotal.toString()) }}</dd>
        </div>
        <div>
          <dt>
            <span class="swatch previous" aria-hidden="true" />
            {{ comparison.previousMonth }}
          </dt>
          <dd>{{ formatKopecks(comparison.previousTotal.toString()) }}</dd>
        </div>
      </dl>
    </template>
    <template v-else-if="status === 'loading'">
      <UiSkeleton class="amount-placeholder" />
      <div class="month-totals">
        <UiSkeleton v-for="month in 2" :key="month" class="month-placeholder" />
      </div>
    </template>
    <p v-else class="note" role="status">Сравнение пока недоступно</p>
  </section>
</template>

<style scoped>
.expense-summary {
  margin-top: 8px;
  padding: 14px;
  border-radius: var(--radius-card);
  background: var(--control);
}

.expense-summary h2 {
  margin: 0;
  color: var(--muted);
  font-size: 16px;
}

.increase {
  --comparison-tone: var(--summary-deficit);
}

.decrease {
  --comparison-tone: var(--summary-income);
}

.amount {
  margin: 4px 0 0;
  color: var(--comparison-tone, var(--text));
  font-size: clamp(24px, 7vw, 32px);
  font-weight: 750;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.note {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 14px;
}

.month-totals {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin: 12px 0 0;
  padding-top: 10px;
  border-top: 1px solid var(--line);
}

.month-totals dt {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
  font-size: 13px;
}

.month-totals dd {
  margin: 2px 0 0;
  color: var(--text);
  font-size: 17px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.swatch {
  flex: 0 0 14px;
  border-top: 2px solid var(--expense);
}

.swatch.previous {
  border-top: 2px dashed var(--muted);
}

.amount-placeholder {
  width: 52%;
  height: clamp(29px, 8.4vw, 38px);
  margin-top: 4px;
}

.month-placeholder {
  height: 38px;
}
</style>
