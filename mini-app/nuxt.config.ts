export default defineNuxtConfig({
  ssr: false,
  nitro: { prerender: { routes: ['/history', '/comparison', '/budgets', '/settings'] } },
  css: ['~/assets/css/main.css'],
  devtools: { enabled: false },
  app: {
    head: {
      htmlAttrs: { lang: 'ru' },
      title: 'Аналитика',
      viewport:
        'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover',
      style: [
        {
          // Paint the document before the blocking Telegram SDK script.
          tagPriority: 40,
          innerHTML: `
          :root {
            --telegram-app-background: var(--tg-theme-header-bg-color, var(--tg-theme-bg-color));
            --startup-background: #f3f7fa;
            --startup-text: #151d29;
          }
          @media (prefers-color-scheme: dark) {
            :root {
              --startup-background: #181d23;
              --startup-text: #f6f8fa;
            }
          }
          :where(html) {
            background: var(--telegram-app-background, var(--startup-background));
          }
        `,
        },
      ],
      script: [{ src: 'https://telegram.org/js/telegram-web-app.js?65' }],
    },
  },
})
