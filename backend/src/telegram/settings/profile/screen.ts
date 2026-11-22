import type { TimeZoneUpdate } from '../../../users/service.ts'

const unavailable = '⚠️ Не удалось открыть настройки часового пояса. Попробуйте позже.'
const instructions =
  'Для смены отправьте /timezone Asia/Yekaterinburg, для сброса — /timezone reset.'

export function timeZoneScreen(timeZone: string | null | undefined) {
  if (timeZone === undefined) return unavailable
  const current =
    timeZone === null ? 'Часовой пояс по умолчанию — UTC.' : `Часовой пояс — ${timeZone}.`
  return `${current}\n${instructions}`
}

export function timeZoneUpdateScreen(result: TimeZoneUpdate | undefined) {
  if (result === 'invalid') return 'Укажите часовой пояс IANA, например Asia/Yekaterinburg.'
  if (result === undefined || result === 'unavailable') return unavailable
  return result.timeZone === null
    ? 'Часовой пояс сброшен. Используется UTC.'
    : `Часовой пояс сохранён — ${result.timeZone}.`
}
