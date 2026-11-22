export default defineNuxtConfig({
  ssr: false,
  nitro: { prerender: { routes: ['/comparison', '/budgets'] } },
  css: ['~/assets/css/main.css'],
  devtools: { enabled: false },
  app: {
    head: {
      htmlAttrs: { lang: 'ru' },
      title: 'Аналитика',
      viewport: 'width=device-width, initial-scale=1, viewport-fit=cover',
      script: [{ src: 'https://telegram.org/js/telegram-web-app.js?65' }],
    },
  },
})
