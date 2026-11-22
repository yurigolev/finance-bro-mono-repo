import { InlineKeyboard } from 'grammy'
import type { MonthlyBudget } from '../../../budgets/types.ts'
import { adjacentMonth } from '../../../shared/calendar.ts'
import { callback, escapeHtml, formatAmount, menu } from '../../ui.ts'

const budgetPageSize = 6
const budgetMonthFormat = new Intl.DateTimeFormat('ru-RU', { month: 'long', timeZone: 'UTC' })

export const budgetError = '⚠️ Не удалось выполнить действие с бюджетом. Попробуйте позже.'

export function budgetPeriod(month: string) {
  return budgetMonthFormat.format(new Date(`${month}-01T00:00:00Z`))
}

function budgetStatus(spent: bigint, limit: bigint | null) {
  if (limit === null) return 'Лимит не задан'
  if (spent > limit) return `🔴 Превышение ${formatAmount(spent - limit, true)}`
  if (spent === limit) return '🟡 Лимит достигнут'
  const remaining = `Осталось ${formatAmount(limit - spent, true)}`
  return spent * 5n >= limit * 4n ? `🟡 Близко к лимиту · ${remaining}` : `🟢 ${remaining}`
}

export function budgetSections(budget: MonthlyBudget, entries: MonthlyBudget['categories']) {
  const cards = [
    { title: 'Общий бюджет', spent: budget.totalSpent, limit: budget.totalLimit },
    ...entries.map(({ name, archived, spent, limit }) => ({
      title: archived ? `${name} (архив)` : name,
      spent,
      limit,
    })),
  ]
  const html = []
  const plain = []
  for (const [index, { title, spent, limit }] of cards.entries()) {
    if (index === 1) {
      html.push('<h3>По категориям</h3>')
      plain.push('По категориям')
    }
    const spentAmount = formatAmount(spent, true)
    const limitAmount = limit === null ? '' : ` из ${formatAmount(limit, true)}`
    const status = budgetStatus(spent, limit)
    html.push(
      `<p><b>${escapeHtml(title)}</b><br>Потрачено <b>${spentAmount}</b>${limitAmount}<br>${escapeHtml(status)}</p>`,
    )
    plain.push(`${title}\nПотрачено ${spentAmount}${limitAmount}\n${status}`)
  }
  return { html: html.join(''), text: plain.join('\n\n') }
}

export function budgetOverviewScreen(
  budget: MonthlyBudget,
  month: string,
  current: string,
  requestedPage: number,
) {
  const lastPage = Math.max(0, Math.ceil(budget.categories.length / budgetPageSize) - 1)
  const page = Math.min(requestedPage, lastPage)
  const entries = budget.categories.slice(page * budgetPageSize, (page + 1) * budgetPageSize)
  const period = budgetPeriod(month)
  const sections = budgetSections(budget, entries)
  const position = lastPage > 0 ? `Страница ${page + 1} из ${lastPage + 1}` : ''
  const rows = []
  const pages = []
  if (page > 0) pages.push(callback('⬅️ Страница', `b:view:${month}:${page - 1}`))
  if (page < lastPage) pages.push(callback('Страница ➡️', `b:view:${month}:${page + 1}`))
  if (pages.length) rows.push(pages)
  const months = []
  if (month > '1000-01') months.push(callback('⬅️ Месяц', `b:view:${adjacentMonth(month, -1)}:0`))
  if (month < current) {
    months.push(callback('К текущему', 'b:current'))
    months.push(callback('Месяц ➡️', `b:view:${adjacentMonth(month, 1)}:0`))
  }
  if (months.length) rows.push(months)
  if (month === current) {
    rows.push([
      callback('Общий лимит', `b:scope:${month}:all:${page}`),
      callback('Лимит по категории', `b:pick:${month}:0`),
    ])
  }
  return {
    html: `<h2>${menu.budgets}</h2><p>${escapeHtml(period)}</p>${sections.html}${position ? `<p>${position}</p>` : ''}`,
    text: [`${menu.budgets}\n${period}`, sections.text, position].filter(Boolean).join('\n\n'),
    keyboard: { reply_markup: new InlineKeyboard(rows) },
  }
}
