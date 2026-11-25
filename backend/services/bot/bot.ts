import { Bot, Composer } from 'grammy'
import { z } from 'zod'
import { isBudgetLimitReply, registerBudgetHandlers } from './budgets/handlers.ts'
import { createTelegramSession, type BotContext } from './context.ts'
import type { TelegramDependencies } from './dependencies.ts'
import { registerHelpHandlers, showHelp } from './help/handlers.ts'
import { createHistory } from './history/handlers.ts'
import type { TelegramInput } from './operation-input.ts'
import { registerReceiptActions } from './operations/card/handlers.ts'
import { dateUpdateKey } from './operations/date/dialog.ts'
import { registerOperationEntry } from './operations/entry/handlers.ts'
import { downloadVoice } from './operations/voice.ts'
import { categorySettingsAction, messageQueuedCallbackPattern } from './patterns.ts'
import {
  categorySettingsUpdateKey,
  createCategorySettings,
} from './settings/categories/handlers.ts'
import { registerProfileCommands } from './settings/profile/handlers.ts'
import { registerStatisticsHandlers } from './statistics/handlers.ts'
import { unavailable } from './ui.ts'

export type { TelegramOperationInput } from './operation-input.ts'

const privateChatSchema = z.object({ id: z.int().positive(), type: z.literal('private') })
const senderSchema = z.object({ id: z.int().positive(), is_bot: z.literal(false) })
const updateIdSchema = z.int().nonnegative()
const messageSchema = z.object({
  message_id: z.int().nonnegative(),
  date: z.int().nonnegative(),
  text: z.string().optional(),
  voice: z
    .object({
      file_id: z.string().min(1),
      duration: z.int().nonnegative(),
      file_size: z.int().nonnegative().optional(),
    })
    .optional(),
})
const callbackSchema = z.object({ id: z.string().min(1), data: z.string().optional() })

function budgetUpdateKey(chatId: number) {
  return `${chatId}:budgets`
}

export function createBot(
  token: string,
  { users, categories, transactions, budgets }: TelegramDependencies,
  operationInput: TelegramInput,
  fetchVoice = downloadVoice,
): Bot<BotContext> {
  const bot = new Bot<BotContext>(token)
  const messageUpdates = new Map<string, Promise<unknown>>()

  async function queueMessageUpdate<T>(key: string, update: () => Promise<T>) {
    const previous = messageUpdates.get(key) ?? Promise.resolve()
    const current = previous.catch(() => {}).then(update)
    messageUpdates.set(key, current)
    try {
      return await current
    } finally {
      if (messageUpdates.get(key) === current) messageUpdates.delete(key)
    }
  }

  async function withOwner<T>(
    telegramId: number,
    operation: (userId: string) => Promise<T>,
  ): Promise<T | undefined> {
    try {
      const userId = await users.getOrCreateUser(telegramId)
      return await operation(userId)
    } catch {
      console.error('FinanceBro: не удалось выполнить операцию пользователя.')
      return undefined
    }
  }

  const categorySettings = createCategorySettings({ categories, withOwner, queueMessageUpdate })

  bot.use((ctx, next) => {
    if (!privateChatSchema.safeParse(ctx.chat).success || !senderSchema.safeParse(ctx.from).success)
      return
    if (!updateIdSchema.safeParse(ctx.update.update_id).success) return
    if (ctx.message !== undefined && !messageSchema.safeParse(ctx.message).success) return
    return next()
  })

  bot.on('callback_query', async (ctx, next) => {
    const callback = callbackSchema.safeParse(ctx.callbackQuery)
    if (!callback.success) return
    const { data } = callback.data
    if (data === undefined) return next()
    if (categorySettingsAction.test(data))
      return queueMessageUpdate(categorySettingsUpdateKey(ctx.chat!.id), next)
    if (data.startsWith('date:')) {
      return queueMessageUpdate(dateUpdateKey(ctx.chat!.id), () =>
        ctx.msgId === undefined ? next() : queueMessageUpdate(`${ctx.chat!.id}:${ctx.msgId}`, next),
      )
    }
    if (data.startsWith('b:')) return queueMessageUpdate(budgetUpdateKey(ctx.chat!.id), next)
    if (!messageQueuedCallbackPattern.test(data)) return next()
    return queueMessageUpdate(`${ctx.chat!.id}:${ctx.msgId}`, next)
  })

  bot.use(createTelegramSession())

  categorySettings.registerNameReplies(bot)

  const dailyHistory = createHistory({ categories, transactions, withOwner })

  registerHelpHandlers(bot)
  dailyHistory.registerMenu(bot)

  // Budget callbacks and replies share one queue.
  bot.on('message:text', (ctx, next) =>
    isBudgetLimitReply(ctx) ? queueMessageUpdate(budgetUpdateKey(ctx.chat.id), next) : next(),
  )
  const budgetHandlers = new Composer<BotContext>()
  registerBudgetHandlers(budgetHandlers, {
    budgets,
    withOwner,
    parseBudgetLimit: operationInput.parseBudgetLimit,
  })
  bot.use(budgetHandlers)
  registerStatisticsHandlers(bot, { loadHistory: dailyHistory.loadHistory, budgets })

  dailyHistory.registerActions(bot)
  registerReceiptActions(bot, { categories, transactions, withOwner, operationInput })

  categorySettings.registerMenu(bot)

  registerProfileCommands(bot, users, withOwner)
  registerOperationEntry(bot, {
    categories,
    transactions,
    withOwner,
    queueMessageUpdate,
    showHelp,
    fetchVoice,
    operationInput,
  })

  bot.on('callback_query', (ctx) => ctx.answerCallbackQuery({ text: unavailable }))

  return bot
}
