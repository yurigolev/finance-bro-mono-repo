<template>
  <div class="ui-menu-list analytics-glass">
    <slot />
  </div>
</template>

<style scoped>
.ui-menu-list {
  --menu-row-inset: 16px;

  overflow: hidden;
  border-radius: var(--radius-card);
  border: 0;
  box-shadow: none;
}

.ui-menu-list > :slotted(.ui-menu-row + .ui-menu-row)::before {
  position: absolute;
  inset-block-start: 0;
  inset-inline: var(--menu-row-divider-start, var(--menu-row-inset)) var(--menu-row-inset);
  border-top: 1px solid color-mix(in srgb, var(--line) 60%, transparent);
  pointer-events: none;
  content: '';
}
</style>
