import type { Composer, Context } from 'grammy'
import type { TelegramDependencies, WithOwner } from '../dependencies.ts'
import { loadOperationCategories } from '../operations/card/handlers.ts'
import { categoryError, readError } from '../operation-ui.ts'
import {
  editHistoryAction,
  historyOperationDetailsOrDeletePromptAction,
  pickHistoryCategoryAction,
  removeHistoryOperationAction,
  setHistoryCategoryAction,
  viewHistoryAction,
} from '../patterns.ts'
import { expandUuid, isUnchanged, menu, sendRichScreen, unavailable } from '../ui.ts'
import { dailyHistoryScreen, historyCategoryPicker, historyOperationScreen } from './screen.ts'

type HistoryDependencies = {
  categories: Pick<TelegramDependencies['categories'], 'listCategories' | 'setCategory'>
  transactions: Pick<
    TelegramDependencies['transactions'],
    'loadDailyHistory' | 'getOperation' | 'getOperationKind' | 'remove'
  >
  withOwner: WithOwner
}

function parseHistoryDay(day: string): string | null {
  if (day.startsWith('0000')) return null
  const date = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6)}`
  const midnight = new Date(`${date}T00:00:00Z`)
  return Number.isFinite(+midnight) && midnight.toISOString().slice(0, 10) === date ? date : null
}

export function createHistory({ categories, transactions, withOwner }: HistoryDependencies) {
  async function loadHistory(telegramId: number, day?: string) {
    const date = day === undefined ? undefined : parseHistoryDay(day)
    return withOwner(telegramId, async (userId) => {
      const history = await transactions.loadDailyHistory(userId, date)
      return history && { ...history, userId }
    })
  }

  async function editHistory(ctx: Context, day?: string, notice?: string, editing = false) {
    if (ctx.msgId === undefined) return ctx.answerCallbackQuery(unavailable)
    const [date, offset = '0'] = day?.split(':') ?? []
    const history = await loadHistory(ctx.from!.id, date)
    if (history === undefined) return ctx.answerCallbackQuery(notice ?? readError)
    if (history === null) return ctx.answerCallbackQuery(unavailable)
    try {
      await sendRichScreen(
        ctx,
        dailyHistoryScreen(history, editing, Number.parseInt(offset, 36)),
        ctx.msgId,
      )
    } catch {
      return ctx.answerCallbackQuery(notice ?? readError)
    }
    return ctx.answerCallbackQuery()
  }

  const openHistory = async (ctx: Context) => {
    const history = await loadHistory(ctx.from!.id)
    if (!history) return ctx.reply(readError)
    return sendRichScreen(ctx, dailyHistoryScreen(history))
  }

  function registerMenu<C extends Context>(bot: Composer<C>) {
    bot.command('recent', openHistory)
    bot.on('message:text').hears([menu.history, 'История'], openHistory)
  }

  function registerActions<C extends Context>(bot: Composer<C>) {
    bot.callbackQuery(viewHistoryAction, (ctx) => {
      const [, day] = ctx.match
      return editHistory(ctx, day)
    })

    bot.callbackQuery(editHistoryAction, (ctx) => {
      return editHistory(ctx, ctx.match[1], undefined, true)
    })

    bot.callbackQuery(historyOperationDetailsOrDeletePromptAction, async (ctx) => {
      if (ctx.msgId === undefined) return ctx.answerCallbackQuery(unavailable)
      const [, action, day, target] = ctx.match
      const operation = await withOwner(ctx.from.id, (userId) =>
        transactions.getOperation(userId, expandUuid(target)),
      )
      if (operation === undefined) return ctx.answerCallbackQuery(readError)
      if (operation === null) return ctx.answerCallbackQuery(unavailable)

      try {
        await sendRichScreen(
          ctx,
          historyOperationScreen(operation, day, target, action === 'hd'),
          ctx.msgId,
        )
      } catch {
        return ctx.answerCallbackQuery(readError)
      }
      return ctx.answerCallbackQuery()
    })

    bot.callbackQuery(pickHistoryCategoryAction, async (ctx) => {
      if (ctx.msgId === undefined) return ctx.answerCallbackQuery(unavailable)
      const [, day, operation, pickerPage] = ctx.match
      const selection = await loadOperationCategories(
        { categories, transactions, withOwner },
        ctx.from.id,
        expandUuid(operation),
      )
      if (selection === undefined) return ctx.answerCallbackQuery(categoryError)
      if (selection === null) return ctx.answerCallbackQuery(unavailable)
      const keyboard = historyCategoryPicker(selection.entries, day, operation, Number(pickerPage))
      try {
        await ctx.editMessageReplyMarkup({ reply_markup: keyboard })
      } catch (error) {
        if (!isUnchanged(error)) return ctx.answerCallbackQuery(categoryError)
      }
      return ctx.answerCallbackQuery()
    })

    bot.callbackQuery(setHistoryCategoryAction, async (ctx) => {
      if (ctx.msgId === undefined) return ctx.answerCallbackQuery(unavailable)
      const [, day, operation, category] = ctx.match
      const categoryId = category === 'none' ? null : expandUuid(category)
      const changed = await withOwner(ctx.from.id, (userId) =>
        categories.setCategory(userId, expandUuid(operation), categoryId),
      )
      if (changed === undefined) return ctx.answerCallbackQuery(categoryError)
      if (!changed) return ctx.answerCallbackQuery(unavailable)
      return editHistory(ctx, day, 'Категория сохранена. Не удалось обновить список.')
    })

    bot.callbackQuery(removeHistoryOperationAction, async (ctx) => {
      if (ctx.msgId === undefined) return ctx.answerCallbackQuery(unavailable)
      const [, day, operation] = ctx.match
      const removed = await withOwner(ctx.from.id, (userId) =>
        transactions.remove(userId, expandUuid(operation)),
      )
      if (removed === undefined)
        return ctx.answerCallbackQuery('Не удалось подтвердить удаление. Проверьте «Историю».')
      if (!removed) return ctx.answerCallbackQuery('Операция не найдена или уже удалена.')
      return editHistory(ctx, day, 'Операция удалена. Не удалось обновить список.')
    })
  }

  return { loadHistory, registerMenu, registerActions }
}
