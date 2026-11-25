import type { Composer, Context } from 'grammy'
import type { TelegramDependencies } from '../dependencies.ts'
import type { createHistory } from '../history/handlers.ts'
import { readError } from '../operation-ui.ts'
import { mainKeyboard, menu, sendRichScreen } from '../ui.ts'
import { statisticsScreen } from './screen.ts'

type StatisticsDependencies = {
  loadHistory: ReturnType<typeof createHistory>['loadHistory']
  budgets: Pick<TelegramDependencies['budgets'], 'monthlyBudget'>
}

export function registerStatisticsHandlers<C extends Context>(
  bot: Composer<C>,
  { loadHistory, budgets }: StatisticsDependencies,
) {
  bot.on('message:text').hears([menu.statistics, 'Статистика'], async (ctx) => {
    const history = await loadHistory(ctx.from!.id)
    if (!history) return ctx.reply(readError, mainKeyboard)

    const month = history.date.slice(0, 7)
    const budget = await budgets
      .monthlyBudget(history.userId, `${month}-01`, history.timeZone)
      .catch(() => null)
    const screen = statisticsScreen(history, month, budget)
    if ('html' in screen) return sendRichScreen(ctx, screen)
    return ctx.reply(screen.text, screen.keyboard)
  })
}
