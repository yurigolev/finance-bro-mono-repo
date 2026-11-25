import { InlineKeyboard } from 'grammy'
import type { CategoryChoice } from '../../../packages/contracts/categories.ts'
import { adjacentDay } from '../../../packages/shared/calendar.ts'
import type {
  DailyHistory,
  OperationDetails,
  OperationInput,
  OperationKind,
  OperationSummary,
} from '../../../packages/contracts/transactions.ts'
import { kindHeading, kindIcon, kinds, noCategory } from '../operation-ui.ts'
import { formatOperationDate } from '../operations/date/format.ts'
import { trailingHighSurrogatePattern } from '../patterns.ts'
import {
  callback,
  compactUuid,
  escapeHtml,
  formatAmount,
  pagedButtons,
  type RichScreen,
} from '../ui.ts'

const dayDateFormat = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
})

export function formatHistoryDate(date: string) {
  return dayDateFormat.format(new Date(`${date}T00:00:00Z`))
}

function shortenDescription(description: string, limit: number): string {
  return description.length > limit
    ? `${description.slice(0, limit - 1).replace(trailingHighSurrogatePattern, '')}…`
    : description
}

function formatOperation(operation: OperationInput): string {
  const amount = formatAmount(operation.amountKopecks)
  return operation.description
    ? `${amount} · ${shortenDescription(operation.description, 200)}`
    : amount
}

export function dailyTotals(operations: OperationSummary[]) {
  const totals = { income: 0n, expense: 0n }
  for (const { kind, amountKopecks } of operations) totals[kind] += amountKopecks
  return totals
}

export function dailySummary(totals: ReturnType<typeof dailyTotals>) {
  return [
    `Общий доход: ${formatAmount(totals.income)}`,
    `Общий расход: ${formatAmount(totals.expense)}`,
  ].join('\n')
}

export function dailyHistoryScreen(
  { date, today, operations }: Pick<DailyHistory, 'date' | 'today' | 'operations'>,
  editing = false,
  requestedOffset = 0,
): RichScreen {
  const formattedDate = formatHistoryDate(date)
  const title = `📅 ${date === today ? 'Сегодня, ' : ''}${formattedDate}`
  const totals = dailyTotals(operations)
  const headings = {
    expense: `${kindHeading.expense} · ${formatAmount(totals.expense)}`,
    income: `${kindHeading.income} · ${formatAmount(totals.income)}`,
  }
  const day = date.replaceAll('-', '')
  const dayOffset = (offset: number) => (offset === 0 ? day : `${day}:${offset.toString(36)}`)
  const rows = kinds.flatMap((kind) =>
    operations
      .filter((operation) => operation.kind === kind)
      .map((operation) => {
        const amount = `${kind === 'income' ? '+' : '−'}${formatAmount(operation.amountKopecks, true)}`
        const description = shortenDescription(operation.description.trim(), 200)
        const category = operation.categoryName ? ` · ${operation.categoryName}` : ''
        const comment = description ? ` (${description})` : ''
        const details = category + comment
        return { operation, amount, details, text: amount + details }
      }),
  )

  function render(textLimit: number) {
    function pageOffsets(footerLength: number) {
      const offsets = [0]
      const baseLength = title.length + footerLength
      let length = baseLength
      let previousKind: OperationKind | undefined
      for (const [index, { operation, text }] of rows.entries()) {
        const kind = operation.kind
        const headingLength = headings[kind].length + 3
        const nextLength = length + text.length + (previousKind === kind ? 1 : headingLength)
        if (nextLength > textLimit && index > offsets[offsets.length - 1]!) {
          offsets.push(index)
          length = baseLength + headingLength + text.length
        } else {
          length = nextLength
        }
        previousKind = kind
      }
      return offsets
    }

    let offsets = pageOffsets(0)
    if (offsets.length > 1) {
      const maxPosition = `Страница ${rows.length} из ${rows.length} · ${rows.length} операций`
      offsets = pageOffsets(maxPosition.length + 2)
    }

    if (editing) {
      // Telegram allows 100 inline buttons, including pagination and the return button.
      offsets = offsets.flatMap((start, index) => {
        const end = offsets[index + 1] ?? rows.length
        const chunks = [start]
        let offset = start
        while (end - offset > 99 - Number(offset > 0) - Number(end < rows.length)) {
          offset += 98 - Number(offset > 0)
          chunks.push(offset)
        }
        return chunks
      })
    }

    const page = offsets.findLastIndex((offset) => offset <= requestedOffset)
    const offset = offsets[page]!
    const current = dayOffset(offset)
    const visible = rows.slice(offset, offsets[page + 1] ?? rows.length)
    const buttons: ReturnType<typeof callback>[][] = []
    const plain = [title]
    const rich = [`<h2>${escapeHtml(title)}</h2>`]
    if (editing) {
      const summary = dailySummary(totals)
      plain.push(summary)
      rich.push(`<p>${escapeHtml(summary).replaceAll('\n', '<br>')}</p>`)
    }

    if (visible.length === 0) {
      plain.push('📭 За этот день операций нет.')
      rich.push('<p>📭 За этот день операций нет.</p>')
    } else if (editing) {
      plain.push('Выберите операцию.')
      rich.push('<p>Выберите операцию.</p>')
      for (const { operation, amount } of visible) {
        buttons.push([
          callback(
            operation.description
              ? `${amount} · ${shortenDescription(operation.description, 36)}`
              : amount,
            `ho:${current}:${compactUuid(operation.id)}`,
          ),
        ])
      }
    } else {
      for (const kind of kinds) {
        const group = visible.filter(({ operation }) => operation.kind === kind)
        if (group.length === 0) continue
        plain.push([headings[kind], ...group.map(({ text }) => text)].join('\n'))
        const lines = group.map(
          ({ amount, details }) => `<b>${escapeHtml(amount)}</b>${escapeHtml(details)}`,
        )
        rich.push(`<h3>${escapeHtml(headings[kind])}</h3><p>${lines.join('<br>')}</p>`)
      }
    }

    if (offsets.length > 1) {
      const position = `Страница ${page + 1} из ${offsets.length} · ${rows.length} операций`
      plain.push(position)
      rich.push(`<p>${position}</p>`)
      const navigation = editing ? 'he' : 'h'
      const pages = []
      if (page > 0)
        pages.push(callback('⬅️ Операции', `${navigation}:${dayOffset(offsets[page - 1]!)}`))
      if (page + 1 < offsets.length)
        pages.push(callback('Ещё операции ➡️', `${navigation}:${dayOffset(offsets[page + 1]!)}`))
      buttons.push(pages)
    }

    if (editing) {
      buttons.push([callback('⬅️ К списку', `h:${current}`)])
    } else {
      const days = [callback('⬅️ День', `h:${adjacentDay(date, -1).replaceAll('-', '')}`)]
      if (date < today) {
        days.push(
          callback('📍 К сегодня', 'h:today'),
          callback('День ➡️', `h:${adjacentDay(date, 1).replaceAll('-', '')}`),
        )
      }
      buttons.push(days)
      if (visible.length > 0) buttons.push([callback('✏️ Редактировать операции', `he:${current}`)])
    }

    return {
      text: plain.join('\n\n'),
      html: rich.join(''),
      keyboard: { reply_markup: new InlineKeyboard(buttons) },
    }
  }

  const rich = render(32_768)
  const plain = render(4_096)
  return {
    html: rich.html,
    text: plain.text,
    keyboard: rich.keyboard,
    plainKeyboard: plain.keyboard,
  }
}

export function historyOperationScreen(
  operation: OperationDetails,
  day: string,
  target: string,
  confirming: boolean,
): RichScreen {
  const title = confirming ? '⚠️ Удалить операцию?' : '🧾 Операция'
  const kind = operation.kind === 'income' ? 'Доход' : 'Расход'
  const details =
    `${kindIcon[operation.kind]} ${kind} · ${formatOperation(operation)} · ${operation.categoryName ?? noCategory}` +
    (operation.operationDate ? `\n${formatOperationDate(operation.operationDate.date)}` : '')
  const buttons = confirming
    ? [
        [
          callback('🗑 Подтвердить удаление', `hc:${day}:${target}`),
          callback('↩️ Отмена', `ho:${day}:${target}`),
        ],
      ]
    : [
        [
          callback('🏷 Сменить категорию', `hp:${day}:${target}:0`),
          callback('🗑 Удалить', `hd:${day}:${target}`),
        ],
        [callback('📅 Изменить дату', `date:edit:${target}`)],
        [callback('⬅️ К выбору операции', `he:${day}`)],
      ]
  return {
    html: `<h2>${title}</h2><p>${escapeHtml(details).replaceAll('\n', '<br>')}</p>`,
    text: `${title}\n\n${details}`,
    keyboard: { reply_markup: new InlineKeyboard(buttons) },
  }
}

export function historyCategoryPicker(
  entries: CategoryChoice[],
  day: string,
  operation: string,
  page: number,
) {
  const buttons = pagedButtons(
    entries,
    page,
    (category) => `hs:${day}:${operation}:${compactUuid(category.id)}`,
    (index) => `hp:${day}:${operation}:${index}`,
  )
  buttons.push(
    [callback('✖️ Снять категорию', `hs:${day}:${operation}:none`)],
    [callback('⬅️ Назад', `ho:${day}:${operation}`)],
  )
  return new InlineKeyboard(buttons)
}
