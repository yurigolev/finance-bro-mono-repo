import { callback, formatAmount, textScreen } from '../../ui.ts'

export const budgetInputPrefix = 'Введите сумму лимита'
export const budgetLimitMessages = {
  stale: 'Месяц изменился или запрос устарел. Откройте «Бюджеты» снова.',
  disabled: 'Лимит отключён.',
  cancelled: '↩️ Настройка лимита отменена.',
  invalid: 'Введите положительную сумму в рублях в ответ на исходную подсказку.',
  saved: '✅ Лимит сохранён.',
}

export function budgetLimitPrompt() {
  return {
    text: `🎯 ${budgetInputPrefix} в рублях.\nНапример, 8 000. Для отмены ответьте «Отмена».`,
    keyboard: { reply_markup: { force_reply: true as const } },
  }
}

export function budgetLimitScreen(
  { categoryName, limit }: { categoryName: string | null; limit: bigint | null },
  month: string,
  scope: string,
  page: string,
) {
  const suffix = `${month}:${scope}:${page}`
  const rows = [[callback(limit === null ? 'Задать сумму' : 'Изменить сумму', `b:edit:${suffix}`)]]
  if (limit !== null) rows.push([callback('Отключить лимит', `b:off:${suffix}`)])
  rows.push([callback('К бюджетам', `b:view:${month}:${page}`)])
  return textScreen(
    categoryName ?? 'Общий лимит',
    limit === null ? 'Лимит не задан.' : formatAmount(limit),
    rows,
  )
}
