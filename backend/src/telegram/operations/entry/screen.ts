import { InlineKeyboard } from 'grammy'
import type { OperationDraft } from '../../../transactions/types.ts'
import { kindIcon } from '../../operation-ui.ts'
import { formatOperationDate } from '../../parsing/operation-date.ts'
import { callback, escapeHtml, formatAmount } from '../../ui.ts'
import { maxVoiceSeconds } from '../voice.ts'

export const clarifyOperationReply =
  '✍️ Уточните сумму и описание одной операции. Например, 480,50 кофе, квартира 40к или 20 000 зарплата.'
export const voiceUnavailableReply = '🎙 Голосовой ввод недоступен. Отправьте операцию текстом.'
export const voiceTooLongReply = `🎙 Отправьте голосовое до ${maxVoiceSeconds} секунд и 1 МБ или введите операцию текстом.`
export const voiceTranscriptionFailedReply =
  '🎙 Не удалось распознать голосовое. Попробуйте ещё раз или отправьте операцию текстом.'

export const operationCancelledScreen = {
  html: '↩️ <b>Запись отменена</b>',
  keyboard: { reply_markup: new InlineKeyboard() },
}

export const duplicateOperationScreen = {
  html: '✅ <b>Операция уже записана</b>\nЗапись доступна в истории.',
  keyboard: { reply_markup: new InlineKeyboard() },
}

export function operationKindScreen(operation: OperationDraft, updateKey: string) {
  const action = (label: string, value: string) => callback(label, `choose:${updateKey}:${value}`)
  const html = [
    '<b>Доход или расход?</b>',
    `<b>${formatAmount(operation.amountKopecks, true)}</b> · ${escapeHtml(operation.description)}`,
    operation.operationDate &&
      `📅 ${escapeHtml(formatOperationDate(operation.operationDate.date))}`,
  ]
    .filter(Boolean)
    .join('\n')
  return {
    html,
    keyboard: {
      reply_markup: new InlineKeyboard([
        [
          action(`${kindIcon.income} Доход`, 'income'),
          action(`${kindIcon.expense} Расход`, 'expense'),
        ],
        [action('↩️ Отмена', 'cancel')],
      ]),
    },
  }
}
