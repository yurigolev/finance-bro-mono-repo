import type { Composer, Context } from 'grammy'
import type { TelegramDependencies, WithOwner } from '../../dependencies.ts'
import type { TelegramInput } from '../../operation-input.ts'
import { categoryError } from '../../operation-ui.ts'
import {
  legacyReceiptRemovalAction,
  pickReceiptCategoryAction,
  rememberReceiptCategoryAction,
  removeReceiptOperationAction,
  setReceiptCategoryAction,
} from '../../patterns.ts'
import {
  expandUuid,
  isUnchanged,
  sendCompactScreen,
  sendRichScreen,
  unavailable,
} from '../../ui.ts'
import {
  categoryChangeReply,
  receiptCategoryPicker,
  receiptScreen,
  removedReceiptScreen,
} from './screen.ts'

type CategorySelectionDependencies = {
  categories: Pick<TelegramDependencies['categories'], 'listCategories'>
  transactions: Pick<TelegramDependencies['transactions'], 'getOperationKind'>
  withOwner: WithOwner
}
type ReceiptDependencies = {
  categories: Pick<
    TelegramDependencies['categories'],
    'listCategories' | 'canRememberCategory' | 'rememberCategory' | 'setCategory'
  >
  transactions: Pick<
    TelegramDependencies['transactions'],
    'getOperationKind' | 'getOperation' | 'remove'
  >
  withOwner: WithOwner
  operationInput: Pick<TelegramInput, 'setCategory'>
}

const ruleError = '⚠️ Не удалось запомнить категорию. Попробуйте позже.'

function isLegacyReceipt(ctx: Context) {
  const source = ctx.msg
  if (!source || !('reply_markup' in source)) return false
  return (
    source.reply_markup?.inline_keyboard
      .flat()
      .some((button) => button.text === 'Выбрать категорию') ?? false
  )
}

export function loadOperationCategories(
  { categories, transactions, withOwner }: CategorySelectionDependencies,
  telegramId: number,
  operationId: string,
) {
  return withOwner(telegramId, async (userId) => {
    const kind = await transactions.getOperationKind(userId, operationId)
    if (!kind) return null
    return { kind, entries: await categories.listCategories(userId, kind) }
  })
}

export function registerReceiptActions<C extends Context>(
  bot: Composer<C>,
  { categories, transactions, withOwner, operationInput }: ReceiptDependencies,
) {
  bot.callbackQuery(legacyReceiptRemovalAction, (ctx) => {
    return ctx.answerCallbackQuery({ text: 'Откройте «Историю», чтобы удалить операцию.' })
  })

  bot.callbackQuery(removeReceiptOperationAction, async (ctx) => {
    if (ctx.msgId === undefined) return ctx.answerCallbackQuery({ text: unavailable })
    const removed = await withOwner(ctx.from.id, (userId) =>
      transactions.remove(userId, expandUuid(ctx.match[1]!)),
    )
    if (removed === undefined)
      return ctx.answerCallbackQuery({
        text: 'Не удалось подтвердить удаление. Проверьте «Историю».',
      })
    if (!removed) return ctx.answerCallbackQuery({ text: 'Операция не найдена или уже удалена.' })
    try {
      await sendCompactScreen(ctx, removedReceiptScreen, ctx.msgId)
      return ctx.answerCallbackQuery()
    } catch {
      return ctx.answerCallbackQuery({ text: 'Операция удалена. Не удалось обновить чек.' })
    }
  })

  bot.callbackQuery(pickReceiptCategoryAction, async (ctx) => {
    const [, mode, operationId, page] = ctx.match
    const receipt = mode === 'rp' || isLegacyReceipt(ctx)
    if (receipt && ctx.msgId === undefined) return ctx.answerCallbackQuery({ text: unavailable })
    if (!receipt && page === 'back') return ctx.answerCallbackQuery({ text: unavailable })
    if (receipt && page === 'back') {
      const operation = await withOwner(ctx.from.id, (userId) =>
        transactions.getOperation(userId, operationId),
      )
      if (operation === undefined) return ctx.answerCallbackQuery({ text: categoryError })
      if (!operation) return ctx.answerCallbackQuery({ text: unavailable })
      try {
        await sendCompactScreen(
          ctx,
          receiptScreen(operation, operation.id, operation.categoryName),
          ctx.msgId,
        )
        return ctx.answerCallbackQuery()
      } catch {
        return ctx.answerCallbackQuery({ text: 'Не удалось обновить чек.' })
      }
    }
    const selection = await loadOperationCategories(
      { categories, transactions, withOwner },
      ctx.from.id,
      operationId,
    )
    if (selection === undefined) return ctx.answerCallbackQuery({ text: categoryError })
    if (!selection) return ctx.answerCallbackQuery({ text: unavailable })

    const screen = receiptCategoryPicker(selection, operationId, Number(page), receipt)
    if (receipt) {
      try {
        await ctx.editMessageReplyMarkup(screen.keyboard)
      } catch (error) {
        if (!isUnchanged(error))
          return ctx.answerCallbackQuery({ text: 'Не удалось открыть категории в чеке.' })
      }
      return ctx.answerCallbackQuery()
    }
    await ctx.answerCallbackQuery()
    return sendRichScreen(ctx, screen)
  })

  bot.callbackQuery(setReceiptCategoryAction, async (ctx) => {
    const [, mode, operation, category] = ctx.match
    const operationId = expandUuid(operation)
    const categoryId = category === 'none' ? null : expandUuid(category)
    const receipt = mode === 'rs' || isLegacyReceipt(ctx)
    if (receipt) {
      if (ctx.msgId === undefined) return ctx.answerCallbackQuery({ text: unavailable })
      const result = await withOwner(ctx.from.id, async (userId) => {
        const change = await operationInput.setCategory(ctx.from.id, operationId, categoryId)
        if (change === 'category-unavailable') return change
        if (change === 'unavailable') return null
        const updated = await transactions.getOperation(userId, operationId)
        if (!updated) return null
        const canRemember =
          categoryId !== null &&
          updated.categoryName !== null &&
          (await categories.canRememberCategory(userId, updated.kind, updated.description))
        return { operation: updated, canRemember }
      })
      if (result === undefined) return ctx.answerCallbackQuery({ text: categoryError })
      if (!result) return ctx.answerCallbackQuery({ text: unavailable })
      if (result === 'category-unavailable') {
        const selection = await loadOperationCategories(
          { categories, transactions, withOwner },
          ctx.from.id,
          operationId,
        )
        if (selection === undefined) return ctx.answerCallbackQuery({ text: categoryError })
        if (!selection) return ctx.answerCallbackQuery({ text: unavailable })
        const screen = receiptCategoryPicker(selection, operationId, 0, true)
        try {
          await ctx.editMessageReplyMarkup(screen.keyboard)
        } catch (error) {
          if (!isUnchanged(error))
            return ctx.answerCallbackQuery({ text: 'Не удалось обновить категории в чеке.' })
        }
        return ctx.answerCallbackQuery({ text: 'Категория недоступна. Выберите другую.' })
      }
      const updated = result.operation
      try {
        const screen = receiptScreen(updated, operationId, updated.categoryName, {
          rememberCategoryId: result.canRemember ? (categoryId ?? undefined) : undefined,
        })
        await sendCompactScreen(ctx, screen, ctx.msgId)
        return ctx.answerCallbackQuery()
      } catch {
        return ctx.answerCallbackQuery({ text: 'Категория сохранена. Не удалось обновить чек.' })
      }
    }
    const changed = await withOwner(ctx.from.id, (userId) =>
      categories.setCategory(userId, operationId, categoryId),
    )
    if (changed === undefined) return ctx.answerCallbackQuery({ text: categoryError })
    if (!changed) return ctx.answerCallbackQuery({ text: unavailable })

    await ctx.answerCallbackQuery()
    return ctx.reply(categoryChangeReply(Boolean(categoryId)))
  })

  bot.callbackQuery(rememberReceiptCategoryAction, async (ctx) => {
    if (ctx.msgId === undefined) return ctx.answerCallbackQuery({ text: unavailable })
    const [, operation, category] = ctx.match
    const operationId = expandUuid(operation)
    const result = await withOwner(ctx.from.id, async (userId) => {
      const remembered = await categories.rememberCategory(
        userId,
        operationId,
        expandUuid(category),
      )
      if (!remembered) return null
      return { operation: await transactions.getOperation(userId, operationId) }
    })
    if (result === undefined) return ctx.answerCallbackQuery({ text: ruleError })
    if (!result) return ctx.answerCallbackQuery({ text: unavailable })
    if (result.operation) {
      const updated = result.operation
      try {
        await sendCompactScreen(
          ctx,
          receiptScreen(updated, operationId, updated.categoryName),
          ctx.msgId,
        )
      } catch {
        return ctx.answerCallbackQuery({ text: 'Правило сохранено. Не удалось обновить чек.' })
      }
    }
    return ctx.answerCallbackQuery({ text: 'Запомнил для следующих операций.' })
  })
}
