<script setup lang="ts">
import { ChartNoAxesColumnIncreasing, Clock, House, Settings, Wallet } from '@lucide/vue'

const destinations = [
  { path: '/', label: 'Обзор', icon: House },
  { path: '/history', label: 'История', icon: Clock },
  { path: '/comparison', label: 'Сравнение', icon: ChartNoAxesColumnIncreasing },
  { path: '/budgets', label: 'Бюджеты', icon: Wallet },
  { path: '/settings', label: 'Настройки', icon: Settings },
]

const route = useRoute()
const activeIndex = computed(() => {
  const matchedPath = route.matched.at(-1)?.aliasOf?.path ?? route.path
  const path = matchedPath.replace(/\/$/, '') || '/'
  return destinations.findIndex((destination) => destination.path === path)
})
</script>

<template>
  <nav
    class="analytics-dock analytics-glass"
    aria-label="Разделы мини-приложения"
    :style="{ '--active-tab': Math.max(activeIndex, 0), '--tab-count': destinations.length }"
  >
    <div class="dock-links">
      <span v-if="activeIndex >= 0" class="dock-indicator" aria-hidden="true" />
      <NuxtLink
        v-for="destination in destinations"
        :key="destination.path"
        :to="destination.path"
        class="dock-link"
      >
        <component :is="destination.icon" :size="21" :stroke-width="2" aria-hidden="true" />
        <span>{{ destination.label }}</span>
      </NuxtLink>
    </div>
  </nav>
</template>

<style scoped>
.analytics-dock {
  position: fixed;
  z-index: 4;
  inset-inline: max(12px, env(safe-area-inset-left, 0px), env(safe-area-inset-right, 0px));
  bottom: calc(var(--analytics-dock-gap) + var(--analytics-bottom-inset));
  max-width: 420px;
  height: var(--analytics-dock-height);
  margin-inline: auto;
  padding: 5px;
  border-radius: var(--radius-pill);
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--glass-highlight) 42%, transparent),
    0 10px 24px color-mix(in srgb, var(--glass-shadow) 29%, transparent);
  isolation: isolate;
}

.dock-links {
  position: relative;
  display: grid;
  grid-template-columns: repeat(var(--tab-count), minmax(0, 1fr));
  height: 100%;
}

.dock-indicator {
  position: absolute;
  z-index: -1;
  inset-block: 0;
  inset-inline-start: 0;
  width: calc(100% / var(--tab-count));
  border: 1px solid color-mix(in srgb, var(--accent) 24%, transparent);
  border-radius: var(--radius-pill);
  background: var(--accent-surface);
  background: linear-gradient(
    147deg,
    color-mix(in srgb, var(--accent) 25%, transparent),
    color-mix(in srgb, var(--accent-surface) 58%, transparent) 44%,
    color-mix(in srgb, var(--accent) 15%, transparent)
  );
  box-shadow:
    inset 0 1px 1px color-mix(in srgb, var(--glass-highlight) 64%, transparent),
    inset 0 -1px 1px color-mix(in srgb, var(--accent) 23%, transparent);
  transform: translateX(calc(var(--active-tab) * 100%));
  transition: transform 360ms cubic-bezier(0.22, 0.78, 0.22, 1);
  pointer-events: none;
}

.dock-link {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  border-radius: var(--radius-pill);
  color: var(--muted);
  font-size: clamp(9px, 2.8vw, 12px);
  font-weight: 650;
  line-height: 1.15;
  text-decoration: none;
  transition: color 180ms ease-out;
}

.dock-link[aria-current='page'] {
  color: var(--accent);
}

.dock-link:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -3px;
}

@media (prefers-reduced-motion: reduce) {
  .dock-indicator,
  .dock-link {
    transition: none;
  }
}
</style>
