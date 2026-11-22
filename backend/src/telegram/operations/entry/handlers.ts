import type { Composer, Context } from 'grammy'
import type { CategoryChoice } from '../../../categories/types.ts'
import { dateInZone } from '../../../shared/calendar.ts'
import type { OperationDraft, OperationKind } from '../../../transactions/types.ts'
import type { BotContext } from '../../context.ts'
import type { QueueMessageUpdate, TelegramDependencies, WithOwner } from '../../dependencies.ts'
import { readError, writeError } from '../../operation-ui.ts'
import { hasOperationDate, parseOperationDate } from '../../parsing/operation-date.ts'
import { parseOperation } from '../../parsing/parser.ts'
import { chooseOperationKindAction, standaloneAmountPattern } from '../../patterns.ts'
import { mainKeyboard, sendCompactScreen, unavailable } from '../../ui.ts'
import { receiptScreen } from '../card/screen.ts'
import { dateUpdateKey } from '../date/dialog.ts'
import { registerDateDialog } from '../date/handlers.ts'
import { dateErrorReply } from '../date/screen.ts'
import { maxVoiceBytes, maxVoiceSeconds, type TranscribeVoice } from '../voice.ts'
import {
  clarifyOperationReply,
  duplicateOperationScreen,
  operationCancelledScreen,
  operationKindScreen,
  voiceTooLongReply,
  voiceTranscriptionFailedReply,
  voiceUnavailableReply,
} from './screen.ts'

type EntryDependencies = {
  users: Pick<TelegramDependencies['users'], 'getTimeZone'>
  categories: Pick<TelegramDependencies['categories'], 'listCategories'>
  transactions: Pick<
    TelegramDependencies['transactions'],
    'getOperation' | 'recordOperation' | 'setOperationDate'
  >
  withOwner: WithOwner
  queueMessageUpdate: QueueMessageUpdate
  showHelp: (ctx: Context) => ReturnType<Context['reply']>
  transcribeVoice?: TranscribeVoice
}
const voiceKeyPrefix = 'telegram:voice:'

export function registerOperationEntry(
  bot: Composer<BotContext>,
  {
    users,
    categories,
    transactions,
    withOwner,
    queueMessageUpdate,
    showHelp,
    transcribeVoice,
  }: EntryDependencies,
) {
  async function askOperationKind(
    ctx: BotContext,
    operation: OperationDraft,
    updateKey: string,
    messageId?: number,
  ) {
    const prompts = (ctx.session.operationKindPrompts ??= {})
    const now = Date.now()
    for (const [key, prompt] of Object.entries(prompts)) {
      if (prompt.expires <= now) delete prompts[key]
    }
    const sent = await sendCompactScreen(ctx, operationKindScreen(operation, updateKey), messageId)
    const promptId = messageId ?? (typeof sent === 'object' ? sent.message_id : undefined)
    if (promptId !== undefined) {
      prompts[updateKey] = {
        telegramId: ctx.from!.id,
        messageId: promptId,
        expires: now + 30 * 60_000,
        operation,
      }
    }
  }

  async function recordAndReply(
    ctx: BotContext,
    operation: OperationDraft,
    updateKey: string,
    messageId?: number,
  ) {
    const prompt = ctx.session.operationKindPrompts?.[updateKey]
    if (!operation.kind && prompt && prompt.expires > Date.now()) return true
    const recording = await withOwner(ctx.from!.id, async (userId) => ({
      userId,
      result: await transactions.recordOperation(userId, operation, updateKey),
    }))
    if (recording === undefined) {
      if (messageId === undefined) await ctx.reply(writeError)
      return false
    }
    const { userId, result } = recording
    if (result.status === 'duplicate') {
      if (messageId !== undefined) await sendCompactScreen(ctx, duplicateOperationScreen, messageId)
      return true
    }
    if (result.status === 'kind-required') {
      await askOperationKind(ctx, operation, updateKey, messageId)
      return true
    }

    let entries: CategoryChoice[] = []
    if (result.categoryName === null && !result.categoryChoices) {
      try {
        entries = await categories.listCategories(userId, result.kind)
      } catch {
        console.error('FinanceBro: не удалось загрузить категории для чека.')
      }
    }
    const screen = receiptScreen(
      { ...operation, kind: result.kind },
      result.id,
      result.categoryName,
      {
        entries,
        matches: result.categoryChoices,
      },
    )
    await sendCompactScreen(ctx, screen, messageId)
    return true
  }

  function submitOperation(
    ctx: BotContext,
    operation: OperationDraft,
    updateKey: string,
    messageId?: number,
  ) {
    return queueMessageUpdate(updateKey, () => recordAndReply(ctx, operation, updateKey, messageId))
  }

  bot.callbackQuery(chooseOperationKindAction, (ctx) => {
    const updateKey = ctx.match[1]!
    const kind = ctx.match[2] as OperationKind | 'cancel'
    return queueMessageUpdate(updateKey, async () => {
      const prompts = ctx.session.operationKindPrompts
      if (!prompts) return ctx.answerCallbackQuery({ text: unavailable })
      const prompt = prompts[updateKey]
      if (
        !prompt ||
        prompt.expires <= Date.now() ||
        prompt.telegramId !== ctx.from.id ||
        prompt.messageId !== ctx.msgId
      )
        return ctx.answerCallbackQuery({ text: unavailable })

      if (kind === 'cancel') {
        await sendCompactScreen(ctx, operationCancelledScreen, prompt.messageId)
      } else if (
        !(await recordAndReply(ctx, { ...prompt.operation, kind }, updateKey, prompt.messageId))
      ) {
        return ctx.answerCallbackQuery({ text: writeError, show_alert: true })
      }
      delete prompts[updateKey]
      return ctx.answerCallbackQuery()
    })
  })

  const confirmOperationDate = registerDateDialog(bot, {
    transactions,
    withOwner,
    queueMessageUpdate,
    submitOperation,
  })

  async function recordInput(ctx: BotContext, input: string, updateKey: string, sentAt: number) {
    if (!hasOperationDate(input)) {
      const operation = parseOperation(input)
      if (!operation) return ctx.reply(clarifyOperationReply, mainKeyboard)
      return submitOperation(ctx, operation, updateKey)
    }

    return queueMessageUpdate(dateUpdateKey(ctx.chat!.id), async () => {
      const zone = await withOwner(ctx.from!.id, (userId) => users.getTimeZone(userId))
      if (zone === undefined) return ctx.reply(readError, mainKeyboard)
      const timeZone = zone ?? 'UTC'
      const today = dateInZone(timeZone, new Date(sentAt * 1000))
      const parsed = parseOperationDate(input, today, parseOperation)
      if (parsed.kind === 'none') return ctx.reply(clarifyOperationReply, mainKeyboard)
      const operation = parsed.text && parseOperation(parsed.text)
      if (parsed.shortNumeric && !operation) {
        const decimalAmount = parseOperation(input)
        if (decimalAmount) return submitOperation(ctx, decimalAmount, updateKey)
      }
      if (parsed.kind === 'error') return ctx.reply(dateErrorReply(parsed.message), mainKeyboard)
      if (!operation || standaloneAmountPattern.test(operation.description)) {
        return ctx.reply(clarifyOperationReply, mainKeyboard)
      }
      if (parsed.confirm) {
        return confirmOperationDate(ctx, operation, updateKey, {
          dates: parsed.dates,
          today,
          timeZone,
        })
      }
      return submitOperation(
        ctx,
        { ...operation, operationDate: { date: parsed.dates[0]!, timeZone } },
        updateKey,
      )
    })
  }

  bot.on('message:text', (ctx) => {
    const { text, date } = ctx.message
    if (text.startsWith('/')) return showHelp(ctx)
    return recordInput(ctx, text, `telegram:${ctx.update.update_id}`, date)
  })

  bot.on('message:voice', async (ctx) => {
    if (!transcribeVoice) return ctx.reply(voiceUnavailableReply, mainKeyboard)
    const { voice, message_id: messageId } = ctx.message
    if (voice.duration > maxVoiceSeconds || (voice.file_size ?? 0) > maxVoiceBytes) {
      return ctx.reply(voiceTooLongReply, mainKeyboard)
    }

    let transcript: string
    try {
      transcript = await transcribeVoice(ctx.api, voice.file_id)
    } catch {
      console.error('FinanceBro: не удалось распознать голосовое сообщение.')
      return ctx.reply(voiceTranscriptionFailedReply, mainKeyboard)
    }
    return recordInput(
      ctx,
      transcript,
      `${voiceKeyPrefix}${ctx.chat.id}:${messageId}`,
      ctx.message.date,
    )
  })
}
