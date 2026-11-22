import { randomBytes } from 'node:crypto'
import type { Composer, Context } from 'grammy'
import { adjacentDay, dateInZone } from '../../../shared/calendar.ts'
import type { OperationDraft } from '../../../transactions/types.ts'
import type { BotContext } from '../../context.ts'
import type { QueueMessageUpdate, TelegramDependencies, WithOwner } from '../../dependencies.ts'
import { readError, writeError } from '../../operation-ui.ts'
import { parseOperationDate } from '../../parsing/operation-date.ts'
import {
  dateDraftAction,
  editOperationDateAction,
  operationDatePromptPattern,
} from '../../patterns.ts'
import { expandUuid, isPhotoMessage, sendCompactScreen, unavailable } from '../../ui.ts'
import { receiptScreen } from '../card/screen.ts'
import { operationCancelledScreen } from '../entry/screen.ts'
import { dateUpdateKey, updateDraftSelection, type DateDraft } from './dialog.ts'
import {
  clarifyDateReply,
  dateDraftScreen,
  dateErrorReply,
  dateInputScreen,
  staleDateReply,
} from './screen.ts'

type DateDialogDependencies = {
  transactions: Pick<TelegramDependencies['transactions'], 'getOperation' | 'setOperationDate'>
  withOwner: WithOwner
  queueMessageUpdate: QueueMessageUpdate
  submitOperation: (
    ctx: BotContext,
    operation: OperationDraft,
    updateKey: string,
    messageId?: number,
  ) => Promise<boolean>
}

function beginDateDraft(
  ctx: BotContext,
  fields: Omit<DateDraft, 'token' | 'telegramId' | 'revision' | 'expires'>,
) {
  const drafts = (ctx.session.dateDrafts ??= {})
  const now = Date.now()
  for (const [token, draft] of Object.entries(drafts)) {
    if (
      draft.expires <= now ||
      (fields.messageId !== undefined && draft.messageId === fields.messageId)
    ) {
      delete drafts[token]
    }
  }
  const draft = {
    ...fields,
    telegramId: ctx.from!.id,
    token: randomBytes(9).toString('base64url'),
    revision: 0,
    expires: now + 30 * 60_000,
  }
  drafts[draft.token] = draft
  return draft
}

export function registerDateDialog(
  bot: Composer<BotContext>,
  { transactions, withOwner, queueMessageUpdate, submitOperation }: DateDialogDependencies,
) {
  async function showDateDraft(ctx: Context, draft: DateDraft) {
    const screen = dateDraftScreen(draft)
    const sent = await sendCompactScreen(ctx, screen, draft.messageId, draft.photo)
    if (typeof sent === 'object') draft.messageId = sent.message_id
  }

  async function restoreDatedReceipt(ctx: Context, operationId: string, messageId: number) {
    const current = await withOwner(ctx.from!.id, (userId) =>
      transactions.getOperation(userId, operationId),
    )
    if (!current) return false
    await sendCompactScreen(
      ctx,
      receiptScreen(current, current.id, current.categoryName),
      messageId,
    )
    return true
  }

  bot.callbackQuery(editOperationDateAction, async (ctx) => {
    const operationId = expandUuid(ctx.match[1])
    const operation = await withOwner(ctx.from.id, (userId) =>
      transactions.getOperation(userId, operationId),
    )
    if (operation === undefined) return ctx.answerCallbackQuery({ text: readError })
    if (!operation || ctx.msgId === undefined) return ctx.answerCallbackQuery({ text: unavailable })
    const { timeZone, date } = operation.operationDate
    const draft = beginDateDraft(ctx, {
      messageId: ctx.msgId,
      photo: isPhotoMessage(ctx, ctx.msgId),
      operation,
      target: { operationId },
      originalDate: date,
      today: dateInZone(timeZone),
      timeZone,
      dates: [],
      choosing: true,
    })
    await showDateDraft(ctx, draft)
    return ctx.answerCallbackQuery()
  })

  bot.callbackQuery(dateDraftAction, async (ctx) => {
    const [, token, revision, action] = ctx.match
    const messageId = ctx.msgId
    const drafts = ctx.session.dateDrafts
    if (!drafts || messageId === undefined) return ctx.answerCallbackQuery({ text: unavailable })
    const draft = drafts[token]
    if (
      !draft ||
      draft.telegramId !== ctx.from.id ||
      draft.revision !== Number(revision) ||
      draft.expires <= Date.now() ||
      draft.messageId !== messageId
    )
      return ctx.answerCallbackQuery({ text: unavailable })

    if (action === 'save') {
      const [date] = draft.dates
      if (!date || draft.choosing || draft.dates.length !== 1)
        return ctx.answerCallbackQuery({ text: unavailable })
      const operationDate = { date, timeZone: draft.timeZone }
      if ('updateKey' in draft.target) {
        if (
          !(await submitOperation(
            ctx,
            { ...draft.operation, operationDate },
            draft.target.updateKey,
            messageId,
          ))
        ) {
          return ctx.answerCallbackQuery({ text: writeError, show_alert: true })
        }
      } else {
        const { operationId } = draft.target
        const changed = await withOwner(ctx.from.id, (userId) =>
          transactions.setOperationDate(userId, operationId, operationDate),
        )
        if (changed === undefined)
          return ctx.answerCallbackQuery({ text: writeError, show_alert: true })
        if (!changed)
          return ctx.answerCallbackQuery({
            text: 'Не удалось перенести операцию. Проверьте дату и запись.',
            show_alert: true,
          })
        await restoreDatedReceipt(ctx, operationId, messageId)
      }
      delete drafts[token]
      return ctx.answerCallbackQuery()
    }
    if (action === 'cancel') {
      delete drafts[token]
      if (
        'updateKey' in draft.target ||
        !(await restoreDatedReceipt(ctx, draft.target.operationId, messageId))
      ) {
        await sendCompactScreen(ctx, operationCancelledScreen, messageId)
      }
      return ctx.answerCallbackQuery()
    }
    if (action === 'input') {
      const sent = await ctx.reply(dateInputScreen.text, dateInputScreen.keyboard)
      draft.promptId = sent.message_id
      return ctx.answerCallbackQuery()
    }
    if (action === 'change') {
      updateDraftSelection(draft)
    } else {
      const index = Number(action.at(-1))
      const date = action.startsWith('quick')
        ? adjacentDay(draft.today, -index)
        : draft.dates[index]
      if (!date) return ctx.answerCallbackQuery({ text: unavailable })
      updateDraftSelection(draft, [date])
    }
    await showDateDraft(ctx, draft)
    return ctx.answerCallbackQuery()
  })

  bot.on('message:text', (ctx, next) => {
    const reply = ctx.message.reply_to_message
    if (
      reply?.from?.id !== ctx.me.id ||
      typeof reply.text !== 'string' ||
      !operationDatePromptPattern.test(reply.text)
    )
      return next()
    return queueMessageUpdate(dateUpdateKey(ctx.chat.id), async () => {
      const draft = Object.values(ctx.session.dateDrafts ?? {}).find(
        (entry) => entry.telegramId === ctx.from.id && entry.promptId === reply.message_id,
      )
      if (!draft || draft.expires <= Date.now()) return ctx.reply(staleDateReply)
      const parsed = parseOperationDate(ctx.message.text, draft.today)
      if (parsed.kind === 'error') return ctx.reply(dateErrorReply(parsed.message))
      if (parsed.kind === 'none' || parsed.text) return ctx.reply(clarifyDateReply)
      updateDraftSelection(draft, parsed.dates)
      return showDateDraft(ctx, draft)
    })
  })

  return function confirmOperationDate(
    ctx: BotContext,
    operation: OperationDraft,
    updateKey: string,
    date: Pick<DateDraft, 'dates' | 'today' | 'timeZone'>,
  ) {
    const draft = beginDateDraft(ctx, {
      ...date,
      operation,
      target: { updateKey },
      choosing: false,
    })
    return showDateDraft(ctx, draft)
  }
}
