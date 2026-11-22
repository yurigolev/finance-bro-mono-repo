<script setup lang="ts">
import type { MonthlyBudget } from '#shared/types/analytics'
import { formatKopecks } from '~/utils/analytics-format'

const props = defineProps<{ budget?: MonthlyBudget; periodLabel?: string }>()

const remaining = computed(() =>
  props.budget?.limitKopecks != null
    ? BigInt(props.budget.limitKopecks) - BigInt(props.budget.spentKopecks)
    : null,
)

const heading = computed(() => {
  const title = remaining.value === null ? 'Бюджет' : 'Остаток бюджета'
  return props.periodLabel ? `${title} на ${props.periodLabel}` : title
})

const usage = computed(() => {
  const limit = BigInt(props.budget?.limitKopecks ?? '0')
  const spent = BigInt(props.budget?.spentKopecks ?? '0')

  if (limit <= 0n || spent <= 0n) return 0
  if (spent >= limit) return 100

  return Number((spent * 10000n) / limit) / 100
})
</script>

<template>
  <section class="budget-overview" aria-labelledby="budget-heading">
    <h2 id="budget-heading">{{ heading }}</h2>

    <template v-if="budget">
      <p v-if="remaining === null" class="budget-no-limit">Общий лимит на этот период не задан</p>
      <p v-else class="budget-amount" :class="{ 'budget-amount-negative': remaining < 0n }">
        {{ formatKopecks(remaining.toString()) }}
      </p>

      <NuxtLink
        to="/budgets"
        class="budget-link"
        :class="{ 'budget-link-at-limit': usage === 100 }"
        :style="{ '--budget-usage': usage + '%' }"
        :aria-label="remaining === null ? undefined : `К бюджетам, использовано ${usage}% лимита`"
      >
        К бюджетам <span class="chevron" aria-hidden="true" />
      </NuxtLink>
    </template>
    <UiSkeleton v-else class="budget-placeholder" />
  </section>
</template>

<style scoped>
.budget-overview {
  margin-top: 8px;
  padding: 14px;
  border-radius: var(--radius-card);
  background: var(--control);
}

.budget-overview h2 {
  margin: 0;
  color: var(--muted);
  font-size: 16px;
}

.budget-amount {
  margin: 4px 0 0;
  color: var(--summary-income);
  font-size: clamp(24px, 7vw, 32px);
  font-weight: 750;
  overflow-wrap: anywhere;
}

.budget-amount-negative {
  color: var(--summary-deficit);
}

.budget-no-limit {
  margin: 4px 0 0;
  color: var(--muted);
}

.budget-link {
  --budget-fill: color-mix(in srgb, var(--accent) 23%, var(--track));
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 44px;
  margin-top: 12px;
  padding: 0 14px;
  border-radius: 14px;
  background: linear-gradient(
    to right,
    var(--budget-fill) var(--budget-usage),
    var(--track) var(--budget-usage)
  );
  color: var(--accent);
  font-weight: 650;
  text-decoration: none;
}

.budget-link-at-limit {
  --budget-fill: color-mix(in srgb, var(--summary-deficit) 21%, var(--track));
  color: var(--summary-deficit);
}

.budget-link .chevron {
  border-color: currentColor;
  margin-top: 0;
  transform: rotate(-45deg);
}

.budget-placeholder {
  height: 36px;
  margin-top: 8px;
}
</style>
