<script setup lang="ts">
provideTelegramWebApp()
useHead({ bodyAttrs: { class: 'analytics-viewport' } })

const pageTransition = {
  name: 'analytics-page',
  mode: 'out-in',
  onEnter(page: Element) {
    page.scrollTop = 0
  },
} as const
</script>

<template>
  <div class="analytics-pages">
    <NuxtPage
      :page-key="(route) => String(route.name)"
      :keepalive="{ max: 3 }"
      :transition="pageTransition"
    />
  </div>
  <AnalyticsNavigation />
</template>
