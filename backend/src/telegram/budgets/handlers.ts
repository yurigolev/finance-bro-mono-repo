import type { Composer, Context } from 'grammy'
import type { BotContext } from '../context.ts'
import type { TelegramDependencies, WithOwner } from '../dependencies.ts'
import { parseBudgetAmount } from '../parsing/parser.ts'
import {
  budgetPromptIconPattern,
  changeBudgetLimitAction,
  pickBudgetCategoryAction,
  viewBudgetAction,
} from '../patterns.ts'
import { expandUuid, mainKeyboard, menu, sendRichScreen, unavailable } from '../ui.ts'
import { budgetCategoryPickerScreen } from './screens/category-picker.ts'
import {
  budgetInputPrefix,
  budgetLimitMessages,
  budgetLimitPrompt,
  budgetLimitScreen,
} from './screens/limit.ts'
import { budgetError, budgetOverviewScreen } from './screens/overview.ts'

type BudgetDependencies = Pick<TelegramDependencies, 'budgets'> & {
  withOwner: WithOwner
}

export type BudgetPrompt = {
  messageId: number
  screenId: number
  month: string
  scope: string
  page: number
}

export function isBudgetLimitReply(ctx: Context) {
  const message = ctx.message
  if (!message || !('text' in message)) return false
  const reply = message.reply_to_message
  return (
    reply?.from?.id === ctx.me.id &&
    'text' in reply &&
    typeof reply.text === 'string' &&
    reply.text.replace(budgetPromptIconPattern, '').startsWith(budgetInputPrefix)
  )
}

export function registerBudgetHandlers(
  bot: Composer<BotContext>,
  { budgets, withOwner }: BudgetDependencies,
) {
  async function renderBudget(ctx: Context, month?: string, page = 0, messageId?: number) {
    const data = await withOwner(ctx.from!.id, (userId) =>
      budgets.viewBudget(userId, month === undefined ? undefined : `${month}-01`),
    )
    if (!data) return false
    const screen = budgetOverviewScreen(
      data.budget,
      data.selected.slice(0, 7),
      data.current.slice(0, 7),
      page,
    )
    await sendRichScreen(ctx, screen, messageId)
    return true
  }

  const openBudgets = async (ctx: Context) => {
    if (!(await renderBudget(ctx))) return ctx.reply(budgetError, mainKeyboard)
  }
  bot.command('budgets', openBudgets)
  bot.on('message:text').hears([menu.budgets, 'Бюджеты'], openBudgets)
  bot.callbackQuery('b:open', async (ctx) => {
    await ctx.answerCallbackQuery()
    return openBudgets(ctx)
  })

  bot.callbackQuery(viewBudgetAction, async (ctx) => {
    const [, month, page] = ctx.match
    const shown = await renderBudget(ctx, month, Number(page ?? 0), ctx.msgId)
    return ctx.answerCallbackQuery(shown ? undefined : { text: budgetError })
  })

  bot.callbackQuery(pickBudgetCategoryAction, async (ctx) => {
    const [, month, page] = ctx.match
    const entries = await withOwner(ctx.from.id, (userId) =>
      budgets.listBudgetCategoryChoices(userId, `${month}-01`),
    )
    if (entries === undefined) return ctx.answerCallbackQuery({ text: budgetError })
    if (entries === null) return ctx.answerCallbackQuery({ text: budgetLimitMessages.stale })
    await sendRichScreen(ctx, budgetCategoryPickerScreen(entries, month, Number(page)), ctx.msgId)
    return ctx.answerCallbackQuery()
  })

  bot.callbackQuery(changeBudgetLimitAction, async (ctx) => {
    const [, action, month, scope, page] = ctx.match
    const monthStart = `${month}-01`
    const categoryId = scope === 'all' ? null : expandUuid(scope)
    if (action === 'off') {
      const result = await withOwner(ctx.from.id, (userId) =>
        budgets.changeBudgetLimit(userId, monthStart, categoryId, { kind: 'disable' }),
      )
      if (result === undefined) return ctx.answerCallbackQuery({ text: budgetError })
      if (result === 'stale') return ctx.answerCallbackQuery({ text: budgetLimitMessages.stale })
      if (result !== 'saved') return ctx.answerCallbackQuery({ text: unavailable })
      delete ctx.session.budgetPrompt
      await ctx.answerCallbackQuery({ text: budgetLimitMessages.disabled })
      return renderBudget(ctx, month, Number(page), ctx.msgId)
    }

    const result = await withOwner(ctx.from.id, (userId) =>
      budgets.viewBudgetLimit(userId, monthStart, categoryId),
    )
    if (result === undefined) return ctx.answerCallbackQuery({ text: budgetError })
    if (result === null) return ctx.answerCallbackQuery({ text: budgetLimitMessages.stale })
    if (action === 'edit' && ctx.msgId !== undefined) {
      const prompt = budgetLimitPrompt()
      const sent = await ctx.reply(prompt.text, prompt.keyboard)
      ctx.session.budgetPrompt = {
        messageId: sent.message_id,
        screenId: ctx.msgId,
        month,
        scope,
        page: Number(page),
      }
    } else {
      await sendRichScreen(ctx, budgetLimitScreen(result, month, scope, page), ctx.msgId)
    }
    return ctx.answerCallbackQuery()
  })

  bot.on('message:text', async (ctx, next) => {
    if (!isBudgetLimitReply(ctx)) return next()
    const { text, reply_to_message: reply } = ctx.message
    const prompt = ctx.session.budgetPrompt
    if (!prompt || reply?.message_id !== prompt.messageId) {
      return ctx.reply(budgetLimitMessages.stale, mainKeyboard)
    }

    const input = text.trim()
    if (input.toLowerCase() === 'отмена' || input === '/cancel') {
      delete ctx.session.budgetPrompt
      return ctx.reply(budgetLimitMessages.cancelled, mainKeyboard)
    }
    const amountKopecks = parseBudgetAmount(text)
    const categoryId = prompt.scope === 'all' ? null : expandUuid(prompt.scope)
    const result = await withOwner(ctx.from.id, (userId) =>
      budgets.changeBudgetLimit(userId, `${prompt.month}-01`, categoryId, {
        kind: 'set',
        amountKopecks,
      }),
    )
    if (result === undefined) return ctx.reply(budgetError)
    if (result === 'invalid') return ctx.reply(budgetLimitMessages.invalid)
    delete ctx.session.budgetPrompt
    if (result !== 'saved') return ctx.reply(budgetLimitMessages.stale, mainKeyboard)
    await ctx.reply(budgetLimitMessages.saved, mainKeyboard)
    await renderBudget(ctx, prompt.month, prompt.page, prompt.screenId)
  })
}
