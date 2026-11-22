import { InlineKeyboard } from 'grammy'
import { formatOperationDate } from '../../parsing/operation-date.ts'
import { callback, escapeHtml, formatAmount } from '../../ui.ts'
import type { DateDraft } from './dialog.ts'

export const dateInputScreen = {
  text: '📅 Введите дату операции\nНапример, 18 ноября.',
  keyboard: { reply_markup: { force_reply: true as const } },
}

export const staleDateReply = '⌛ Запрос даты устарел. Снова нажмите «Изменить дату».'
export const clarifyDateReply = '📅 Ответьте на подсказку одной датой, например 18 ноября.'

export function dateErrorReply(message: string) {
  return `⚠️ ${message}`
}

export function dateDraftScreen(draft: DateDraft) {
  const { operation, choosing, dates, originalDate, target } = draft
  const editing = 'operationId' in target
  const action = (label: string, value: string) =>
    callback(label, `date:${draft.token}:${draft.revision}:${value}`)
  const cancel = action('↩️ Отмена', 'cancel')
  const change = action('📅 Дата', 'change')
  const amount = formatAmount(operation.amountKopecks, true)
  const buttons: ReturnType<typeof callback>[][] = []
  let title: string
  let detail = ''
  let date = ''

  if (choosing) {
    title = '📅 Выберите дату'
    if (originalDate) date = `Текущая дата: ${formatOperationDate(originalDate)}`
    buttons.push([
      action('Сегодня', 'quick0'),
      action('Вчера', 'quick1'),
      action('Позавчера', 'quick2'),
    ])
    buttons.push([{ ...action('⌨️ Ввести дату', 'input'), style: 'primary' }, cancel])
  } else if (dates.length > 1) {
    title = '🗓 Уточните дату'
    detail = 'День недели и число расходятся. Выберите один вариант.'
    const labels = dates.map(formatOperationDate)
    if (labels[0] === labels[1]) {
      labels[0] += dates[0]! > dates[1]! ? ' · Ближе' : ' · Раньше'
      labels[1] += dates[1]! > dates[0]! ? ' · Ближе' : ' · Раньше'
    }
    buttons.push(...labels.map((label, index) => [action(label, `pick${index}`)]))
    buttons.push([change, cancel])
  } else {
    title = editing ? '📅 Перенести операцию?' : '🧾 Подтвердите операцию'
    date = formatOperationDate(dates[0]!)
    buttons.push([
      { ...action(editing ? '✅ Сохранить дату' : '✅ Записать', 'save'), style: 'success' },
    ])
    buttons.push([change, cancel])
  }

  const html = [
    `<b>${title}</b>`,
    `<b>${amount}</b> · ${escapeHtml(operation.description)}`,
    date && `📅 ${escapeHtml(date)}`,
    detail,
  ]
    .filter(Boolean)
    .join('\n')
  return { html, keyboard: { reply_markup: new InlineKeyboard(buttons) } }
}
