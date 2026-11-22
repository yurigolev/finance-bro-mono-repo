import type { InjectionKey } from 'vue'

type TelegramEvent = 'themeChanged' | 'activated'

interface TelegramWebApp {
  initData: string
  platform?: string
  colorScheme: 'light' | 'dark'
  ready?: () => void
  expand?: () => void
  setBackgroundColor?: (color: 'bg_color') => void
  onEvent?: (event: TelegramEvent, callback: () => void) => void
  offEvent?: (event: TelegramEvent, callback: () => void) => void
  isVersionAtLeast?: (version: string) => boolean
}

type Refresh = (background?: boolean) => void
const telegramSession: InjectionKey<{ initData?: string; refreshers: Set<Refresh> }> =
  Symbol('telegram-session')

export function provideTelegramWebApp() {
  const telegram = import.meta.client
    ? (window as Window & { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp
    : undefined
  const initData = telegram?.initData || undefined
  const webApp = initData ? telegram : undefined
  const refreshers = new Set<Refresh>()
  provide(telegramSession, { initData, refreshers })

  let colorPreference: MediaQueryList | undefined
  let macRefreshTimer: number | undefined
  let lastReturnAt = -Infinity
  const hasActivationEvent = !!(webApp?.onEvent && webApp.isVersionAtLeast?.('8.0'))

  function refresh(background = false) {
    refreshers.forEach((callback) => callback(background))
  }

  function handleReturn() {
    const now = performance.now()
    if (document.visibilityState !== 'visible' || now - lastReturnAt < 100) return
    lastReturnAt = now
    refresh(true)
  }

  function handleThemeChange() {
    document.documentElement.dataset.theme =
      webApp?.colorScheme ?? (colorPreference?.matches ? 'dark' : 'light')
  }

  if (import.meta.client) {
    colorPreference = window.matchMedia('(prefers-color-scheme: dark)')
    if (webApp) document.documentElement.dataset.telegram = ''
    handleThemeChange()
  }

  onMounted(() => {
    if (webApp) {
      webApp.onEvent?.('themeChanged', handleThemeChange)
      if (hasActivationEvent) webApp.onEvent?.('activated', handleReturn)
      document.addEventListener('visibilitychange', handleReturn)
      window.addEventListener('focus', handleReturn)
      if (webApp.platform === 'macos') {
        // macOS may reveal the existing Mini App without firing an activation event.
        macRefreshTimer = window.setInterval(() => refresh(true), 10_000)
      }
      if (webApp.isVersionAtLeast?.('6.1')) webApp.setBackgroundColor?.('bg_color')
      webApp.ready?.()
      webApp.expand?.()
    } else {
      colorPreference?.addEventListener('change', handleThemeChange)
    }
  })

  onUnmounted(() => {
    colorPreference?.removeEventListener('change', handleThemeChange)
    webApp?.offEvent?.('themeChanged', handleThemeChange)
    if (hasActivationEvent) webApp?.offEvent?.('activated', handleReturn)
    document.removeEventListener('visibilitychange', handleReturn)
    window.removeEventListener('focus', handleReturn)
    window.clearInterval(macRefreshTimer)
    delete document.documentElement.dataset.telegram
    delete document.documentElement.dataset.theme
  })
}

export function useTelegramWebApp(refresh: Refresh) {
  const session = inject(telegramSession)
  let hasActivated = false
  onActivated(() => {
    session?.refreshers.add(refresh)
    refresh(hasActivated)
    hasActivated = true
  })
  onDeactivated(() => session?.refreshers.delete(refresh))
  return session?.initData
}
