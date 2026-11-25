<script setup lang="ts">
import { ToastProvider } from 'reka-ui'

provideTelegramWebApp()
useHead({ bodyAttrs: { class: 'analytics-viewport' } })

const pageTransition = {
  name: 'analytics-page',
  onEnter(page: Element) {
    page.scrollTop = 0
  },
} as const
</script>

<template>
  <ToastProvider label="Уведомление" :duration="2000" disable-swipe>
    <div class="analytics-pages">
      <NuxtPage
        :page-key="(route) => String(route.name)"
        :keepalive="{ max: 5 }"
        :transition="pageTransition"
      />
    </div>
    <AnalyticsNavigation />
    <UiMessages />
  </ToastProvider>
</template>
