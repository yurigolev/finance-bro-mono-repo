<script setup lang="ts">
import { ChevronRight } from '@lucide/vue'
import type { Component } from 'vue'

defineProps<{
  label: string
  detail?: string
  value?: string
  icon?: Component
  as?: 'button' | 'div'
}>()
</script>

<template>
  <component
    :is="as ?? 'button'"
    :type="as === 'div' ? undefined : 'button'"
    class="ui-menu-row"
    :class="{ 'ui-menu-row-with-icon': icon }"
  >
    <component :is="icon" v-if="icon" class="menu-icon" aria-hidden="true" />
    <span class="menu-copy">
      <span>{{ label }}</span>
      <span v-if="detail" class="menu-detail">{{ detail }}</span>
    </span>
    <span v-if="value" class="menu-value">{{ value }}</span>
    <ChevronRight
      v-if="as !== 'div'"
      class="menu-chevron"
      :size="16"
      :stroke-width="2.5"
      aria-hidden="true"
    />
    <slot v-else name="action" />
  </component>
</template>

<style scoped>
.ui-menu-row {
  --menu-icon-size: 30px;
  --menu-row-gap: 14px;

  position: relative;
  display: flex;
  align-items: center;
  gap: var(--menu-row-gap);
  width: 100%;
  min-height: var(--menu-row-height, 52px);
  padding: 8px var(--menu-row-inset, 16px);
  text-align: left;
  font-size: 17px;
  font-weight: 400;
  line-height: 1.24;
  overflow-wrap: anywhere;
}

.ui-menu-row-with-icon {
  --menu-row-divider-start: calc(
    var(--menu-row-inset) + var(--menu-icon-size) + var(--menu-row-gap)
  );
}

.menu-icon {
  flex: none;
  width: var(--menu-icon-size);
  height: var(--menu-icon-size);
  padding: 6px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--accent-surface) 75%, transparent);
  color: var(--accent);
}

.menu-copy {
  flex: 1;
  min-width: 0;
}

.menu-chevron {
  flex: none;
  color: var(--muted);
}

.menu-detail,
.menu-value {
  color: var(--muted);
}

.menu-detail {
  display: block;
  margin-top: 2px;
  font-size: 13px;
}

.menu-value {
  max-width: 60%;
  text-align: right;
}

@media (prefers-reduced-motion: no-preference) {
  button.ui-menu-row {
    transition: background-color 140ms ease-out;
  }
}

@media (hover: hover) {
  button.ui-menu-row:enabled:hover {
    background-color: color-mix(in srgb, var(--accent) 10%, transparent);
  }
}

button.ui-menu-row:enabled:active {
  background-color: color-mix(in srgb, var(--accent) 15%, transparent);
}
</style>
