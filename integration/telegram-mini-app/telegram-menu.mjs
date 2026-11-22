import { readFile, writeFile } from 'node:fs/promises'

async function callTelegram(token, method, body = new URLSearchParams()) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    body,
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null)
  const data = await response?.json().catch(() => null)
  if (!response?.ok || !data?.ok) {
    throw new Error(`Telegram ${method} завершился ошибкой (HTTP ${response?.status ?? 'недоступен'}).`)
  }
  return data.result
}

async function run() {
  const { TEST_TELEGRAM_BOT_TOKEN: token, TEST_TELEGRAM_BOT_USERNAME } = process.env
  const expectedUsername = TEST_TELEGRAM_BOT_USERNAME?.replace(/^@/, '').toLowerCase()
  if (!token || !expectedUsername) {
    throw new Error('Укажите отдельные TEST_TELEGRAM_BOT_TOKEN и TEST_TELEGRAM_BOT_USERNAME тестового бота.')
  }

  const [action, backupPath, publicUrl] = process.argv.slice(2)
  if (!backupPath || !['set', 'restore'].includes(action) || (action === 'set') !== Boolean(publicUrl)) {
    throw new Error('Использование: telegram-menu.mjs set <backup.json> <https-url> или restore <backup.json>.')
  }

  let nextMenuButton
  if (action === 'set') {
    const url = URL.parse(publicUrl)
    if (url?.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new Error('Укажите публичный HTTPS URL Mini App без учётных данных, query или fragment.')
    }
    nextMenuButton = { type: 'web_app', text: 'Аналитика', web_app: { url: url.href } }
  }

  const bot = await callTelegram(token, 'getMe')
  if (bot.username?.toLowerCase() !== expectedUsername) {
    throw new Error('Токен и имя тестового бота не совпадают.')
  }

  if (action === 'set') {
    const previousButton = await callTelegram(token, 'getChatMenuButton')
    const backup = JSON.stringify({ botId: bot.id, menuButton: previousButton }, null, 2)
    await writeFile(backupPath, backup + '\n', { flag: 'wx', mode: 0o600 })
  } else {
    const backup = JSON.parse(await readFile(backupPath, 'utf8'))
    if (backup.botId !== bot.id || !['default', 'commands', 'web_app'].includes(backup.menuButton?.type)) {
      throw new Error('Снимок меню не принадлежит выбранному тестовому боту или повреждён.')
    }
    nextMenuButton = backup.menuButton
  }

  await callTelegram(token, 'setChatMenuButton', new URLSearchParams({
    menu_button: JSON.stringify(nextMenuButton),
  }))
  const actualButton = await callTelegram(token, 'getChatMenuButton')
  if (
    actualButton.type !== nextMenuButton.type || actualButton.text !== nextMenuButton.text
    || actualButton.web_app?.url !== nextMenuButton.web_app?.url
  ) {
    throw new Error('Telegram вернул настройки меню, отличные от ожидаемых. Проверьте меню тестового бота.')
  }
  console.log(action === 'set' ? 'Кнопка «Аналитика» включена.' : 'Меню тестового бота восстановлено.')
}

try {
  await run()
} catch (error) {
  console.error(error instanceof SyntaxError ? 'Не удалось прочитать JSON снимка меню.' : error.message)
  process.exitCode = 1
}
