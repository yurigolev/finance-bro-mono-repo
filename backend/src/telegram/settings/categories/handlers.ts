import type { Composer } from 'grammy'
import type { OperationKind } from '../../../transactions/types.ts'
import type { BotContext, NameEdit } from '../../context.ts'
import type { QueueMessageUpdate, TelegramDependencies, WithOwner } from '../../dependencies.ts'
import { categoryError } from '../../operation-ui.ts'
import {
  addCategoryAction,
  archiveCategoryAction,
  categoryCatalogAction,
  categoryDetailsOrRenameAction,
  categoryNamePromptPattern,
  categoryRulesPageAction,
  deleteCategoryRuleAction,
} from '../../patterns.ts'
import {
  expandUuid,
  isMissingEditableMessage,
  mainKeyboard,
  menu,
  sendRichScreen,
  unavailable,
} from '../../ui.ts'
import { registerBuiltInWords } from '../built-in-words/handlers.ts'
import {
  categoryCatalogueScreen,
  categoryDetailsScreen,
  categoryMessages,
  categoryNamePrompt,
  categoryRulesScreen,
  settingsScreen,
} from './screen.ts'

type CategorySettingsDependencies = {
  categories: Pick<
    TelegramDependencies['categories'],
    | 'addCategory'
    | 'archiveCategory'
    | 'bindBuiltInGroup'
    | 'changeBuiltInRule'
    | 'deleteCategoryRule'
    | 'getBuiltInRule'
    | 'listBuiltInTargets'
    | 'listCategories'
    | 'listCategoryRules'
    | 'renameCategory'
  >
  withOwner: WithOwner
  queueMessageUpdate: QueueMessageUpdate
}

export function categorySettingsUpdateKey(chatId: number) {
  return `${chatId}:settings`
}

export function createCategorySettings({
  categories,
  withOwner,
  queueMessageUpdate,
}: CategorySettingsDependencies) {
  async function askCategoryName(
    ctx: BotContext,
    edit: NameEdit,
    settingsId: number,
    currentName?: string,
  ) {
    const { text, keyboard } = categoryNamePrompt(edit.kind, currentName)
    const sent = await ctx.reply(text, keyboard)
    const previous = ctx.session.categoryNamePrompt
    if (!previous || sent.message_id > previous.messageId) {
      ctx.session.categoryNamePrompt = {
        edit,
        messageId: sent.message_id,
        settingsId,
        saving: false,
      }
    }
  }

  const openCategories = (ctx: BotContext) =>
    queueMessageUpdate(categorySettingsUpdateKey(ctx.chat!.id), async () => {
      const messageId = ctx.session.settingsMessageId
      if (messageId !== undefined) {
        try {
          await sendRichScreen(ctx, settingsScreen(), messageId)
          return
        } catch (error) {
          if (!isMissingEditableMessage(error)) throw error
          delete ctx.session.settingsMessageId
        }
      }
      const sent = await sendRichScreen(ctx, settingsScreen())
      if (
        sent &&
        typeof sent === 'object' &&
        'message_id' in sent &&
        typeof sent.message_id === 'number'
      ) {
        ctx.session.settingsMessageId = sent.message_id
      }
    })

  function registerNameReplies(bot: Composer<BotContext>) {
    bot.on('message:text', async (ctx, next) => {
      const { text, reply_to_message: reply } = ctx.message
      if (
        reply?.from?.id !== ctx.me.id ||
        !('text' in reply) ||
        typeof reply.text !== 'string' ||
        !categoryNamePromptPattern.test(reply.text)
      ) {
        return next()
      }

      const prompt = ctx.session.categoryNamePrompt
      if (prompt?.messageId !== reply.message_id) {
        return ctx.reply(categoryMessages.staleName, mainKeyboard)
      }
      if (prompt.saving) return
      prompt.saving = true

      const { kind, categoryId } = prompt.edit
      const result = await withOwner(ctx.from!.id, (userId) =>
        categoryId
          ? categories.renameCategory(userId, categoryId, text)
          : categories.addCategory(userId, kind, text),
      )
      prompt.saving = false

      if (result === 'duplicate') return ctx.reply(categoryMessages.duplicateName)
      if (result === 'invalid') return ctx.reply(categoryMessages.invalidName)
      if (result === undefined) return ctx.reply(categoryError)

      if (ctx.session.categoryNamePrompt === prompt) delete ctx.session.categoryNamePrompt
      if (result === 'unavailable') return ctx.reply(unavailable)
      const notice = categoryId ? categoryMessages.renamed : categoryMessages.added
      return queueMessageUpdate(categorySettingsUpdateKey(ctx.chat.id), async () => {
        const entries = await withOwner(ctx.from!.id, (userId) =>
          categories.listCategories(userId, kind),
        )
        if (!entries) return ctx.reply(notice)
        try {
          return await sendRichScreen(
            ctx,
            categoryCatalogueScreen(kind, entries, 0, notice),
            prompt.settingsId,
          )
        } catch {
          return ctx.reply(notice)
        }
      })
    })
  }

  function registerSavedRules(bot: Composer<BotContext>) {
    bot.callbackQuery(categoryRulesPageAction, async (ctx) => {
      const [, , page] = ctx.match
      if (ctx.msgId === undefined) return ctx.answerCallbackQuery(unavailable)
      const rules = await withOwner(ctx.from.id, (userId) => categories.listCategoryRules(userId))
      if (rules === undefined) return ctx.answerCallbackQuery(categoryMessages.rulesLoadError)

      try {
        await sendRichScreen(ctx, categoryRulesScreen(rules, Number(page)), ctx.msgId)
      } catch {
        return ctx.answerCallbackQuery(categoryMessages.rulesShowError)
      }
      return ctx.answerCallbackQuery()
    })

    bot.callbackQuery(deleteCategoryRuleAction, async (ctx) => {
      if (ctx.msgId === undefined) return ctx.answerCallbackQuery(unavailable)
      const [, rule, category, page] = ctx.match
      const result = await withOwner(ctx.from.id, async (userId) => ({
        deleted: await categories.deleteCategoryRule(
          userId,
          expandUuid(rule),
          category === 'none' ? null : expandUuid(category),
        ),
        rules: await categories.listCategoryRules(userId),
      }))
      if (result === undefined) return ctx.answerCallbackQuery(categoryMessages.rulesUpdateError)

      try {
        await sendRichScreen(ctx, categoryRulesScreen(result.rules, Number(page)), ctx.msgId)
      } catch {
        return ctx.answerCallbackQuery(
          result.deleted ? categoryMessages.ruleDeletedReopen : unavailable,
        )
      }
      return ctx.answerCallbackQuery(
        result.deleted ? categoryMessages.ruleDeleted : categoryMessages.ruleStale,
      )
    })
  }

  function registerCatalogue(bot: Composer<BotContext>) {
    bot.callbackQuery(categoryCatalogAction, async (ctx) => {
      if (ctx.msgId === undefined) return ctx.answerCallbackQuery(unavailable)
      const [, kindValue, page] = ctx.match
      const kind = kindValue as OperationKind
      const entries = await withOwner(ctx.from.id, (userId) =>
        categories.listCategories(userId, kind),
      )
      if (!entries) return ctx.answerCallbackQuery(categoryError)
      await ctx.answerCallbackQuery()
      return sendRichScreen(ctx, categoryCatalogueScreen(kind, entries, Number(page)), ctx.msgId)
    })

    bot.callbackQuery(categoryDetailsOrRenameAction, async (ctx) => {
      if (ctx.msgId === undefined) return ctx.answerCallbackQuery(unavailable)
      const [, action, kindValue, categoryId] = ctx.match
      const kind = kindValue as OperationKind
      const entries = await withOwner(ctx.from.id, (userId) =>
        categories.listCategories(userId, kind),
      )
      if (!entries) return ctx.answerCallbackQuery(categoryError)
      const category = entries.find((entry) => entry.id === categoryId)
      if (!category) return ctx.answerCallbackQuery(unavailable)

      await ctx.answerCallbackQuery()
      if (action === 'rename') {
        return askCategoryName(ctx, { kind, categoryId }, ctx.msgId, category.name)
      }
      return sendRichScreen(ctx, categoryDetailsScreen(kind, category), ctx.msgId)
    })

    bot.callbackQuery(addCategoryAction, async (ctx) => {
      if (ctx.msgId === undefined) return ctx.answerCallbackQuery(unavailable)
      const kind = ctx.match[1] as OperationKind
      await ctx.answerCallbackQuery()
      return askCategoryName(ctx, { kind }, ctx.msgId)
    })

    bot.callbackQuery(archiveCategoryAction, async (ctx) => {
      if (ctx.msgId === undefined) return ctx.answerCallbackQuery(unavailable)
      const [, kindValue, categoryId] = ctx.match
      const archived = await withOwner(ctx.from.id, (userId) =>
        categories.archiveCategory(userId, categoryId),
      )
      if (archived === undefined) return ctx.answerCallbackQuery(categoryError)
      if (!archived) return ctx.answerCallbackQuery(unavailable)

      await ctx.answerCallbackQuery(categoryMessages.archived)
      if (!kindValue) return sendRichScreen(ctx, settingsScreen(), ctx.msgId)
      const kind = kindValue as OperationKind
      const entries = await withOwner(ctx.from.id, (userId) =>
        categories.listCategories(userId, kind),
      )
      if (entries) return sendRichScreen(ctx, categoryCatalogueScreen(kind, entries, 0), ctx.msgId)
    })
  }

  function registerMenu(bot: Composer<BotContext>) {
    bot.command('categories', openCategories)
    bot.on('message:text').hears([menu.settings, 'Настройки'], openCategories)

    bot.callbackQuery('settings:menu', async (ctx) => {
      if (ctx.msgId === undefined) return ctx.answerCallbackQuery(unavailable)
      await ctx.answerCallbackQuery()
      return sendRichScreen(ctx, settingsScreen(), ctx.msgId)
    })

    registerSavedRules(bot)
    registerBuiltInWords(bot, {
      categories,
      withOwner,
      queueSettingsUpdate: (chatId, update) =>
        queueMessageUpdate(categorySettingsUpdateKey(chatId), update),
    })
    registerCatalogue(bot)
  }

  return { registerNameReplies, registerMenu }
}
