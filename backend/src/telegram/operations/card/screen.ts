import { InlineKeyboard } from 'grammy'
import { starterCategoryName } from '../../../categories/starter-categories.ts'
import type { CategoryChoice } from '../../../categories/types.ts'
import type { OperationInput, OperationKind } from '../../../transactions/types.ts'
import { kindHeading, noCategory } from '../../operation-ui.ts'
import { formatOperationDate } from '../../parsing/operation-date.ts'
import { receiptLineBreakPattern } from '../../patterns.ts'
import {
  callback,
  compactUuid,
  escapeHtml,
  formatAmount,
  pagedButtons,
  textScreen,
} from '../../ui.ts'

type ReceiptOptions = {
  entries?: CategoryChoice[]
  matches?: CategoryChoice[]
  rememberCategoryId?: string
}

export const removedReceiptScreen = {
  html: '🗑 Операция удалена.',
  keyboard: { reply_markup: new InlineKeyboard() },
}

export function receiptScreen(
  operation: OperationInput,
  id: string,
  categoryName: string | null,
  { entries = [], matches, rememberCategoryId }: ReceiptOptions = {},
) {
  const select = ({ id: categoryId, name }: CategoryChoice) =>
    callback(name, `rs:${compactUuid(id)}:${compactUuid(categoryId)}`)
  const quickChoices = entries.filter(({ name }) => [...name].length <= 12).slice(0, 3)
  const buttons = matches
    ? matches.map((category) => [select(category)])
    : quickChoices.length
      ? [quickChoices.map(select)]
      : []
  const pickerLabel = matches
    ? '🏷 Все категории'
    : categoryName === null
      ? '🏷 Выбрать категорию'
      : '🏷 Категория'
  const chooseCategory = callback(pickerLabel, `rp:${id}:0`)
  buttons.push(
    categoryName === null
      ? [chooseCategory]
      : [chooseCategory, callback('✖️ Снять', `rs:${compactUuid(id)}:none`)],
  )
  buttons.push([
    callback('📅 Дата', `date:edit:${compactUuid(id)}`),
    callback('🗑 Удалить', `rv:${compactUuid(id)}`),
  ])
  if (rememberCategoryId !== undefined) {
    const label = `🧠 Запомнить: ${operation.description} → ${categoryName}`
    buttons.push([
      callback(
        [...label].length <= 60 ? label : '🧠 Запомнить категорию для этого описания',
        `rm:${compactUuid(id)}:${compactUuid(rememberCategoryId)}`,
      ),
    ])
  }

  const income = operation.kind === 'income'
  const category = `🏷 ${matches ? 'Выберите категорию' : (categoryName ?? noCategory)}`
  const normalizedCategory = categoryName?.trim().toLowerCase()
  const repeatsCategory =
    normalizedCategory !== undefined &&
    (operation.description.trim().toLowerCase() === normalizedCategory ||
      starterCategoryName(operation.kind, operation.description)?.toLowerCase() ===
        normalizedCategory)
  const date = operation.operationDate && formatOperationDate(operation.operationDate.date)
  const marker = income ? '📈' : '📉'
  const amount = `${income ? '+ ' : '− '}${formatAmount(operation.amountKopecks)}`
  const description = operation.description.trim().replace(receiptLineBreakPattern, ' ')
  const comment = !repeatsCategory && description ? ` (${escapeHtml(description)})` : ''
  const html = [
    `${marker} <b>${amount}</b>${comment}`,
    escapeHtml(category),
    date && `📅 ${escapeHtml(date)}`,
  ]
    .filter(Boolean)
    .join('\n')
  return { html, keyboard: { reply_markup: new InlineKeyboard(buttons) } }
}

export function receiptCategoryPicker(
  { entries, kind }: { entries: CategoryChoice[]; kind: OperationKind },
  operationId: string,
  page: number,
  receipt: boolean,
) {
  const target = compactUuid(operationId)
  const setAction = receipt ? 'rs' : 'set'
  const pickAction = receipt ? 'rp' : 'pick'
  const buttons = pagedButtons(
    entries,
    page,
    (category) => `${setAction}:${target}:${compactUuid(category.id)}`,
    (index) => `${pickAction}:${operationId}:${index}`,
  )
  buttons.push([callback('✖️ Снять категорию', `${setAction}:${target}:none`)])
  if (receipt) buttons.push([callback('🧾 К чеку', `rp:${operationId}:back`)])
  return textScreen('🏷 Выберите категорию', kindHeading[kind], buttons)
}

export function categoryChangeReply(assigned: boolean) {
  return assigned ? '✅ Категория назначена.' : '🏷 Категория снята.'
}
