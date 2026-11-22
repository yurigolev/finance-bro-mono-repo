import { createHash } from 'node:crypto'
import type { Composer, Context } from 'grammy'
import { normalizeBuiltInWord, starterCategories } from '../../../categories/starter-categories.ts'
import type { BotContext } from '../../context.ts'
import type { TelegramDependencies, WithOwner } from '../../dependencies.ts'
import { kinds } from '../../operation-ui.ts'
import {
  bindBuiltInWordGroupAction,
  builtInWordDetailsAction,
  builtInWordGroupAction,
  changeBuiltInWordMappingAction,
  pickBuiltInWordCategoryAction,
} from '../../patterns.ts'
import { expandUuid, isMissingEditableMessage, sendRichScreen, unavailable } from '../../ui.ts'
import {
  builtInCategoryPickerScreen,
  builtInGroupBoundScreen,
  builtInWordDetailsScreen,
  builtInWordGroupScreen,
  builtInWordsMenu,
  wordMessages,
  wordSearchPrompt,
  wordSearchResultsScreen,
  type BuiltInWord,
} from './screen.ts'

type BuiltInWordsDependencies = {
  categories: Pick<
    TelegramDependencies['categories'],
    'bindBuiltInGroup' | 'changeBuiltInRule' | 'getBuiltInRule' | 'listBuiltInTargets'
  >
  withOwner: WithOwner
  queueSettingsUpdate: <T>(chatId: number, update: () => Promise<T>) => Promise<T>
}

const builtInGroups = kinds.flatMap((kind) =>
  starterCategories[kind].map((group) => ({ ...group, kind })),
)
const builtInWords = builtInGroups.flatMap((group) =>
  group.words.map((word) => ({
    group,
    word,
    id: createHash('sha256')
      .update(`${group.kind}:${normalizeBuiltInWord(word)}`)
      .digest('base64url')
      .slice(0, 12),
  })),
)

export function registerBuiltInWords(
  bot: Composer<BotContext>,
  { categories, withOwner, queueSettingsUpdate }: BuiltInWordsDependencies,
) {
  async function showBuiltInWord(ctx: Context, entry: BuiltInWord, messageId?: number) {
    const { group, word } = entry
    const data = await withOwner(ctx.from!.id, async (userId) => {
      const targets = await categories.listBuiltInTargets(userId, group.kind)
      const rule = await categories.getBuiltInRule(userId, group.kind, word)
      return { target: targets.find(({ key }) => key === group.key), rule }
    })
    if (!data) {
      return ctx.callbackQuery
        ? ctx.answerCallbackQuery(wordMessages.error)
        : ctx.reply(wordMessages.error)
    }
    const screen = builtInWordDetailsScreen(entry, data)
    if (ctx.callbackQuery) await ctx.answerCallbackQuery()
    return sendRichScreen(ctx, screen, messageId)
  }

  bot.callbackQuery('bw:menu', async (ctx) => {
    if (ctx.msgId === undefined) return ctx.answerCallbackQuery(unavailable)
    await ctx.answerCallbackQuery()
    return sendRichScreen(ctx, builtInWordsMenu(builtInGroups), ctx.msgId)
  })

  bot.callbackQuery('bw:find', async (ctx) => {
    if (ctx.msgId === undefined) return ctx.answerCallbackQuery(unavailable)
    await ctx.answerCallbackQuery()
    const sent = await ctx.reply(wordSearchPrompt.text, wordSearchPrompt.keyboard)
    ctx.session.builtInWordSearchPrompt = { messageId: sent.message_id, settingsId: ctx.msgId }
  })

  bot.on('message:text', async (ctx, next) => {
    const reply = ctx.message.reply_to_message
    if (
      reply?.from?.id !== ctx.me.id ||
      !('text' in reply) ||
      (reply.text !== wordSearchPrompt.text && `🔎 ${reply.text}` !== wordSearchPrompt.text)
    )
      return next()
    const { text } = ctx.message
    const word = normalizeBuiltInWord(text)
    const results = builtInWords.filter((entry) => normalizeBuiltInWord(entry.word) === word)
    const prompt = ctx.session.builtInWordSearchPrompt
    const settingsId = prompt?.messageId === reply.message_id ? prompt.settingsId : undefined
    if (results.length === 0) return ctx.reply(wordMessages.noResults)
    const render = (messageId?: number) =>
      results.length === 1
        ? showBuiltInWord(ctx, results[0], messageId)
        : sendRichScreen(ctx, wordSearchResultsScreen(text, results), messageId)
    return queueSettingsUpdate(ctx.chat.id, async () => {
      try {
        return await render(settingsId)
      } catch (error) {
        if (settingsId === undefined || !isMissingEditableMessage(error)) throw error
        return render()
      }
    })
  })

  bot.callbackQuery(builtInWordGroupAction, async (ctx) => {
    const group = builtInGroups.find(({ key }) => key === ctx.match[1])
    if (!group || ctx.msgId === undefined) return ctx.answerCallbackQuery(unavailable)
    const targets = await withOwner(ctx.from.id, (userId) =>
      categories.listBuiltInTargets(userId, group.kind),
    )
    if (!targets) return ctx.answerCallbackQuery(wordMessages.error)
    const target = targets.find(({ key }) => key === group.key)
    const entries = builtInWords
      .filter((entry) => entry.group === group)
      .map(({ word, id }) => ({ name: word, id }))
    const screen = builtInWordGroupScreen(group, entries, Number(ctx.match[2] ?? 0), target)
    await ctx.answerCallbackQuery()
    return sendRichScreen(ctx, screen, ctx.msgId)
  })

  bot.callbackQuery(builtInWordDetailsAction, async (ctx) => {
    const entry = builtInWords.find(({ id }) => id === ctx.match[1])
    if (!entry || ctx.msgId === undefined) return ctx.answerCallbackQuery(unavailable)
    return showBuiltInWord(ctx, entry, ctx.msgId)
  })

  bot.callbackQuery(pickBuiltInWordCategoryAction, async (ctx) => {
    const [, action, id, page] = ctx.match
    const entry = builtInWords.find((word) => word.id === id)
    const group = action === 'bp' ? entry?.group : builtInGroups.find(({ key }) => key === id)
    if (!group || ctx.msgId === undefined) return ctx.answerCallbackQuery(unavailable)
    const targets = await withOwner(ctx.from.id, (userId) =>
      categories.listBuiltInTargets(userId, group.kind),
    )
    if (!targets) return ctx.answerCallbackQuery(wordMessages.error)
    const available = action === 'bp' ? targets : targets.filter(({ key }) => key === null)
    available.sort((first, second) => first.name.localeCompare(second.name, 'ru'))
    const screen = builtInCategoryPickerScreen(
      action,
      id,
      Number(page),
      entry?.word ?? group.name,
      available,
    )
    await ctx.answerCallbackQuery()
    return sendRichScreen(ctx, screen, ctx.msgId)
  })

  bot.callbackQuery(changeBuiltInWordMappingAction, async (ctx) => {
    const [, id, action] = ctx.match
    const entry = builtInWords.find((word) => word.id === id)
    if (!entry || ctx.msgId === undefined) return ctx.answerCallbackQuery(unavailable)
    const target = action === 'off' ? null : action === 'reset' ? 'reset' : expandUuid(action)
    const changed = await withOwner(ctx.from.id, (userId) =>
      categories.changeBuiltInRule(userId, entry.group.kind, entry.word, target),
    )
    if (changed === undefined) return ctx.answerCallbackQuery(wordMessages.error)
    if (!changed) return ctx.answerCallbackQuery(unavailable)
    return showBuiltInWord(ctx, entry, ctx.msgId)
  })

  bot.callbackQuery(bindBuiltInWordGroupAction, async (ctx) => {
    const [, key, category] = ctx.match
    const group = builtInGroups.find((entry) => entry.key === key)
    if (!group || ctx.msgId === undefined) return ctx.answerCallbackQuery(unavailable)
    const changed = await withOwner(ctx.from.id, (userId) =>
      categories.bindBuiltInGroup(userId, group.kind, key, expandUuid(category)),
    )
    if (changed === undefined) return ctx.answerCallbackQuery(wordMessages.error)
    if (!changed) return ctx.answerCallbackQuery(unavailable)
    await ctx.answerCallbackQuery(wordMessages.bound)
    return sendRichScreen(ctx, builtInGroupBoundScreen(group), ctx.msgId)
  })
}
