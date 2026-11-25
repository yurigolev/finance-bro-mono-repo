import { InlineKeyboard } from 'grammy'
import type { OperationDraft } from '../../../../packages/contracts/transactions.ts'
import { kindIcon } from '../../operation-ui.ts'
import { formatOperationDate } from '../date/format.ts'
import { callback, compactUuid, escapeHtml, formatAmount, pagedButtons } from '../../ui.ts'
import type { OperationCategoryPrompt } from '../../operation-input.ts'
import { maxVoiceSeconds } from '../voice.ts'

export const clarifyOperationReply =
  '✍️ Укажите сумму одной операции. Например, 480,50 кофе, + 10 000 или − 500.'
export const voiceTooLongReply = `🎙 Отправьте голосовое до ${maxVoiceSeconds} секунд и 1 МБ или введите операцию текстом.`
export const voiceTranscriptionProgressReply = '⏳ Расшифровываю голосовое…'
export const voiceDownloadFailedReply =
  '🎙 Не удалось загрузить голосовое из Telegram. Отправьте его ещё раз или введите операцию текстом.'
export const voiceTranscriptionFailedReply =
  '🎙 Не удалось распознать голосовое. Попробуйте ещё раз или отправьте операцию текстом.'
export const voiceEmptyTranscriptReply =
  '🎙 В голосовом не удалось распознать слова. Запишите его ещё раз или введите операцию текстом.'
export const voiceOperationFailedReply = `🎙 Не удалось разобрать операцию из голосового.\n${clarifyOperationReply}`
export const voiceTimeZoneFailedReply =
  '⚠️ Не удалось загрузить часовой пояс для даты операции. Попробуйте позже.'
export const voiceProcessingFailedReply =
  '⚠️ Не удалось завершить обработку голосового. Проверьте «Историю» перед повторной отправкой.'

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
  const amount = `<b>${formatAmount(operation.amountKopecks, true)}</b>`
  const html = [
    '<b>Доход или расход?</b>',
    operation.description ? `${amount} · ${escapeHtml(operation.description)}` : amount,
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

export function operationCategoryScreen(
  { entries, operation }: Pick<OperationCategoryPrompt, 'entries' | 'operation'>,
  token: string,
  page = 0,
) {
  const buttons = pagedButtons(
    entries,
    page,
    ({ id }) => `pc:${token}:select:${compactUuid(id)}`,
    (nextPage) => `pc:${token}:page:${nextPage}`,
  )
  buttons.push([
    callback('Без категории', `pc:${token}:select:none`),
    callback('↩️ Отмена', `pc:${token}:select:cancel`),
  ])
  const amount = formatAmount(operation.amountKopecks, true)
  const description = escapeHtml(operation.description)
  return {
    html: [
      '<b>Категория больше недоступна</b>',
      description ? `${amount} · ${description}` : amount,
      'Выберите другую категорию или запишите операцию без категории.',
    ].join('\n'),
    keyboard: { reply_markup: new InlineKeyboard(buttons) },
  }
}
