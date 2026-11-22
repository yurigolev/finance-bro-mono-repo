<script setup lang="ts">
import { ChartNoAxesColumnIncreasing, House, Wallet } from '@lucide/vue'

const destinations = [
  { path: '/', label: 'Обзор', icon: House },
  { path: '/comparison', label: 'Сравнение', icon: ChartNoAxesColumnIncreasing },
  { path: '/budgets', label: 'Бюджеты', icon: Wallet },
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
    class="analytics-dock"
    aria-label="Разделы аналитики"
    :style="{ '--active-tab': Math.max(activeIndex, 0) }"
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
  padding: 4px;
  border: 1px solid var(--line);
  border-color: color-mix(in srgb, var(--line) 58%, transparent);
  border-radius: var(--radius-pill);
  background: var(--background);
  box-shadow:
    0 6px 24px rgb(11 31 53 / 13%),
    inset 0 1px 0 rgb(255 255 255 / 22%);
  isolation: isolate;
}

@supports (backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)) {
  .analytics-dock {
    background: linear-gradient(
      160deg,
      color-mix(in srgb, var(--background) 87%, transparent),
      color-mix(in srgb, var(--control) 71%, transparent)
    );
    -webkit-backdrop-filter: blur(18px) saturate(145%);
    backdrop-filter: blur(18px) saturate(145%);
  }
}

.dock-links {
  position: relative;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  height: 100%;
}

.dock-indicator {
  position: absolute;
  z-index: -1;
  inset-block: 0;
  inset-inline-start: 0;
  width: calc(100% / 3);
  border: 1px solid color-mix(in srgb, var(--accent) 13%, transparent);
  border-radius: var(--radius-pill);
  background: linear-gradient(
    155deg,
    color-mix(in srgb, var(--accent-surface) 88%, transparent),
    color-mix(in srgb, var(--accent-surface) 64%, transparent)
  );
  box-shadow: inset 0 1px 1px rgb(255 255 255 / 26%);
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
  gap: 2px;
  border-radius: var(--radius-pill);
  color: var(--muted);
  font-size: 12px;
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
