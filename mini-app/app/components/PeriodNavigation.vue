<script setup lang="ts">
import { ChevronLeft, ChevronRight } from '@lucide/vue'

withDefaults(
  defineProps<{
    hasPrevious: boolean
    hasNext: boolean
    previousLabel?: string
    nextLabel?: string
  }>(),
  { previousLabel: 'Предыдущий период', nextLabel: 'Следующий период' },
)

defineEmits<{ previous: []; next: [] }>()
</script>

<template>
  <div class="period-range">
    <button
      class="period-arrow"
      type="button"
      :aria-label="previousLabel"
      :disabled="!hasPrevious"
      @click="$emit('previous')"
    >
      <ChevronLeft :size="22" aria-hidden="true" />
    </button>
    <div class="period-label" aria-live="polite">
      <slot />
    </div>
    <button
      class="period-arrow"
      type="button"
      :aria-label="nextLabel"
      :disabled="!hasNext"
      @click="$emit('next')"
    >
      <ChevronRight :size="22" aria-hidden="true" />
    </button>
  </div>
</template>

<style scoped>
.period-range {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) 44px;
  align-items: center;
  gap: 8px;
  margin: 6px 0 8px;
  color: var(--text);
  font-size: 17px;
  font-weight: 750;
}

.period-label {
  display: grid;
  justify-items: center;
  text-align: center;
  text-wrap: balance;
}

.period-arrow {
  display: grid;
  place-items: center;
  height: 44px;
  border-radius: var(--radius-pill);
  background: var(--control);
  color: var(--muted);
}

.period-arrow:disabled {
  opacity: 0.45;
  cursor: default;
}
</style>
