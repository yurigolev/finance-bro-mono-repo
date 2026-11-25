import { InlineKeyboard } from 'grammy'
import type { MonthlyBudget } from '../../../packages/contracts/budgets.ts'
import type { DailyHistory } from '../../../packages/contracts/transactions.ts'
import { budgetPeriod, budgetSections } from '../budgets/screens/overview.ts'
import { dailySummary, dailyTotals, formatHistoryDate } from '../history/screen.ts'
import { callback, escapeHtml, mainKeyboard, menu, type RichScreen } from '../ui.ts'

export function statisticsScreen(
  { date, operations }: Pick<DailyHistory, 'date' | 'operations'>,
  month: string,
  budget: MonthlyBudget | null,
): RichScreen | { text: string; keyboard: typeof mainKeyboard } {
  const title = `${menu.statistics} за сегодня, ${formatHistoryDate(date)}`
  const summary = dailySummary(dailyTotals(operations))
  const heading = `Бюджет за месяц · ${budgetPeriod(month)}`
  if (!budget) {
    return {
      text: `${title}\n\n${summary}\n\n${heading}\nНе удалось загрузить бюджет.`,
      keyboard: mainKeyboard,
    }
  }

  const visibleCategories = budget.categories.slice(0, 3)
  const sections = budgetSections(budget, visibleCategories)
  const remaining = budget.categories.length - visibleCategories.length
  const more = remaining ? `Ещё лимитов по категориям · ${remaining}` : ''
  const html =
    `<h2>${escapeHtml(title)}</h2><p>${summary.split('\n').map(escapeHtml).join('<br>')}</p>` +
    `<h3>${escapeHtml(heading)}</h3>${sections.html}${more ? `<p>${more}</p>` : ''}`
  const text = [`${title}\n\n${summary}`, heading, sections.text, more].filter(Boolean).join('\n\n')
  return {
    html,
    text,
    keyboard: { reply_markup: new InlineKeyboard([[callback('🎯 Открыть бюджеты', 'b:open')]]) },
  }
}
