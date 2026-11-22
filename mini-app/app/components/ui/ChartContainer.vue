<script setup lang="ts">
// Adapted from the shadcn-vue ChartContainer registry component.
import type { CSSProperties } from 'vue'

type ChartConfig = Record<string, { label: string; color: string }>

const props = defineProps<{ config: ChartConfig }>()
const colors = computed<CSSProperties>(() =>
  Object.fromEntries(
    Object.entries(props.config).map(([key, { color }]) => [`--color-${key}`, color]),
  ),
)
</script>

<template>
  <div data-slot="chart" :style="colors">
    <slot :config="config" />
  </div>
</template>
