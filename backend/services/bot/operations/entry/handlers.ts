import { randomBytes } from 'node:crypto'
import type { Composer, Context } from 'grammy'
import type { MessageEntity } from 'grammy/types'
import type { CategoryChoice } from '../../../../packages/contracts/categories.ts'
import type { InputContext, ParseError } from '../../../../packages/contracts/input.ts'
import type { OperationKind } from '../../../../packages/contracts/transactions.ts'
import type { BotContext } from '../../context.ts'
import type { QueueMessageUpdate, TelegramDependencies, WithOwner } from '../../dependencies.ts'
import type { TelegramInput, TelegramOperationDraft } from '../../operation-input.ts'
import { readError, writeError } from '../../operation-ui.ts'
import { chooseOperationKindAction } from '../../patterns.ts'
import {
  expandUuid,
  isMissingEditableMessage,
  isUnchanged,
  mainKeyboard,
  sendCompactScreen,
  unavailable,
} from '../../ui.ts'
import { receiptScreen } from '../card/screen.ts'
import { dateUpdateKey } from '../date/dialog.ts'
import { registerDateDialog } from '../date/handlers.ts'
import { dateErrorReply } from '../date/screen.ts'
import { registerOperationBatch } from './batch.ts'
import { downloadVoice, maxVoiceBytes, maxVoiceSeconds } from '../voice.ts'
import {
  clarifyOperationReply,
  duplicateOperationScreen,
  operationCancelledScreen,
  operationCategoryScreen,
  operationKindScreen,
  voiceDownloadFailedReply,
  voiceEmptyTranscriptReply,
  voiceOperationFailedReply,
  voiceProcessingFailedReply,
  voiceTimeZoneFailedReply,
  voiceTooLongReply,
  voiceTranscriptionFailedReply,
  voiceTranscriptionProgressReply,
} from './screen.ts'

type EntryDependencies = {
  categories: Pick<TelegramDependencies['categories'], 'listCategories'>
  transactions: Pick<TelegramDependencies['transactions'], 'getOperation' | 'setOperationDate'>
  withOwner: WithOwner
  queueMessageUpdate: QueueMessageUpdate
  showHelp: (ctx: Context) => ReturnType<Context['reply']>
  fetchVoice: typeof downloadVoice
  operationInput: TelegramInput
}
const voiceKeyPrefix = 'telegram:voice:'
const operationCategoryAction =
  /^pc:([A-Za-z0-9_-]{12}):(?:page:(\d{1,10})|select:(none|cancel|[A-Za-z0-9_-]{21}[AQgw]))$/u

function processorErrorReply({ error, message }: ParseError, voice: boolean) {
  if (error === 'invalid_date' && message) return dateErrorReply(message)
  if (error === 'unrecognized') return voice ? voiceOperationFailedReply : clarifyOperationReply
  if (!voice) return readError
  if (error === 'empty_transcript') return voiceEmptyTranscriptReply
  if (error === 'audio_too_large' || error === 'audio_too_long') return voiceTooLongReply
  if (
    error === 'transcription_timeout' ||
    error === 'transcription_failed' ||
    error === 'unsupported_audio'
  ) {
    return voiceTranscriptionFailedReply
  }
  return voiceProcessingFailedReply
}

async function sendEntryReply(
  ctx: BotContext,
  text: string,
  messageId?: number,
  transcript?: string,
) {
  let options: { entities?: MessageEntity[] } = {}
  if (transcript) {
    const prefix = text + '\n\n'
    const limit = 4096 - prefix.length
    const quote =
      transcript.length <= limit
        ? transcript
        : transcript.slice(0, limit - 1).replace(/[\uD800-\uDBFF]$/u, '') + '…'
    text = prefix + quote
    options = { entities: [{ type: 'blockquote', offset: prefix.length, length: quote.length }] }
  }
  if (messageId !== undefined) {
    try {
      return await ctx.api.editMessageText(ctx.chat!.id, messageId, text, options)
    } catch (error) {
      if (isUnchanged(error)) return
      if (!isMissingEditableMessage(error)) throw error
    }
  }
  return ctx.reply(text, { ...mainKeyboard, ...options })
}

export function registerOperationEntry(
  bot: Composer<BotContext>,
  {
    categories,
    transactions,
    withOwner,
    queueMessageUpdate,
    showHelp,
    fetchVoice,
    operationInput,
  }: EntryDependencies,
) {
  async function askOperationKind(
    ctx: BotContext,
    operation: TelegramOperationDraft,
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

  async function askReplacementCategory(
    ctx: BotContext,
    operation: TelegramOperationDraft,
    updateKey: string,
    messageId?: number,
  ) {
    const { kind, parsedInput } = operation
    if (!kind || !parsedInput) return false
    const refreshed = await operationInput.loadContext(ctx.from!.id).catch(() => null)
    if (!refreshed) return false
    const entries = refreshed.categories
      .filter((category) => category.kind === kind)
      .map(({ id, kind, name }) => ({ id, kind, name }))
    const prompts = (ctx.session.operationCategoryPrompts ??= {})
    const now = Date.now()
    const token = randomBytes(9).toString('base64url')
    const sent = await sendCompactScreen(
      ctx,
      operationCategoryScreen({ entries, operation }, token),
      messageId,
    )
    const promptId = messageId ?? (typeof sent === 'object' ? sent.message_id : undefined)
    if (promptId === undefined) return false
    for (const [expiredToken, prompt] of Object.entries(prompts)) {
      if (prompt.expires <= now || prompt.updateKey === updateKey) delete prompts[expiredToken]
    }
    prompts[token] = {
      entries,
      operation: {
        ...operation,
        parsedInput: {
          ...parsedInput,
          kind,
          candidates: entries,
        },
      },
      updateKey,
      messageId: promptId,
      telegramId: ctx.from!.id,
      expires: now + 30 * 60_000,
    }
    return true
  }

  async function recordAndReply(
    ctx: BotContext,
    operation: TelegramOperationDraft,
    updateKey: string,
    messageId?: number,
    transcript?: string,
  ) {
    const prompt = ctx.session.operationKindPrompts?.[updateKey]
    if (!operation.kind && prompt && prompt.expires > Date.now()) {
      if (messageId !== undefined && messageId !== prompt.messageId) {
        await sendEntryReply(
          ctx,
          'Выберите «Доход» или «Расход» в предыдущем сообщении.',
          messageId,
        )
      }
      return true
    }
    const replacement = Object.values(ctx.session.operationCategoryPrompts ?? {}).find(
      (entry) => entry.updateKey === updateKey && entry.expires > Date.now(),
    )
    if (operation.parsedInput?.categoryId === undefined && replacement) {
      if (messageId !== undefined && messageId !== replacement.messageId) {
        await sendEntryReply(ctx, 'Выберите категорию в предыдущем сообщении.', messageId)
      }
      return true
    }
    const recording = await withOwner(ctx.from!.id, async (userId) => ({
      userId,
      result: await operationInput.submit(ctx.from!.id, operation, updateKey),
    }))
    if (recording === undefined) {
      if (transcript) await sendEntryReply(ctx, writeError, messageId, transcript)
      else if (messageId === undefined) await ctx.reply(writeError)
      else if (!ctx.callbackQuery) await sendEntryReply(ctx, writeError, messageId)
      return false
    }
    const { userId, result } = recording
    if (result.status === 'category-unavailable') {
      if (await askReplacementCategory(ctx, operation, updateKey, messageId)) return true
      if (!ctx.callbackQuery) await sendEntryReply(ctx, writeError, messageId, transcript)
      return false
    }
    if (result.status === 'date-invalid') {
      if (!ctx.callbackQuery) await sendEntryReply(ctx, writeError, messageId, transcript)
      return false
    }
    if (result.status === 'duplicate') {
      if (messageId !== undefined) await sendCompactScreen(ctx, duplicateOperationScreen, messageId)
      return true
    }
    if (result.status === 'kind-required') {
      await askOperationKind(ctx, operation, updateKey, messageId)
      return true
    }

    let entries: CategoryChoice[] = []
    const matches = result.categoryChoices
    if (result.categoryName === null && !matches) {
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
        matches,
      },
    )
    await sendCompactScreen(ctx, screen, messageId)
    return true
  }

  function submitOperation(
    ctx: BotContext,
    operation: TelegramOperationDraft,
    updateKey: string,
    messageId?: number,
    transcript?: string,
  ) {
    return queueMessageUpdate(updateKey, () =>
      recordAndReply(ctx, operation, updateKey, messageId, transcript),
    )
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

  bot.callbackQuery(operationCategoryAction, (ctx) => {
    const [, token, page, choice] = ctx.match
    const updateKey = ctx.session.operationCategoryPrompts?.[token!]?.updateKey
    if (!updateKey) return ctx.answerCallbackQuery({ text: unavailable })
    return queueMessageUpdate(updateKey, async () => {
      const prompts = ctx.session.operationCategoryPrompts
      const prompt = prompts?.[token!]
      if (
        !prompt ||
        prompt.expires <= Date.now() ||
        prompt.telegramId !== ctx.from.id ||
        prompt.messageId !== ctx.msgId
      ) {
        return ctx.answerCallbackQuery({ text: unavailable })
      }
      if (page !== undefined) {
        await sendCompactScreen(
          ctx,
          operationCategoryScreen(prompt, token!, Number(page)),
          prompt.messageId,
        )
        return ctx.answerCallbackQuery()
      }
      if (choice === 'cancel') {
        await sendCompactScreen(ctx, operationCancelledScreen, prompt.messageId)
      } else {
        const categoryId = choice === 'none' ? null : expandUuid(choice!)
        if (categoryId && !prompt.entries.some(({ id }) => id === categoryId)) {
          return ctx.answerCallbackQuery({ text: unavailable })
        }
        const operation: TelegramOperationDraft = {
          ...prompt.operation,
          parsedInput: { ...prompt.operation.parsedInput!, categoryId },
        }
        if (!(await recordAndReply(ctx, operation, updateKey, prompt.messageId))) {
          return ctx.answerCallbackQuery({ text: writeError, show_alert: true })
        }
      }
      delete prompts![token!]
      return ctx.answerCallbackQuery()
    })
  })

  const confirmOperationDate = registerDateDialog(bot, {
    transactions,
    withOwner,
    queueMessageUpdate,
    submitOperation,
    parseDate: operationInput.parseDate,
  })

  const showBatch = registerOperationBatch(bot, operationInput, queueMessageUpdate)

  async function recordRemoteInput(
    ctx: BotContext,
    input: string | File,
    updateKey: string,
    sentAt: number,
    messageId?: number,
  ) {
    const voice = typeof input !== 'string'
    let context: InputContext
    try {
      context = {
        ...(await operationInput.loadContext(ctx.from!.id)),
        sentAt: new Date(sentAt * 1000).toISOString(),
      }
    } catch {
      console.error('FinanceBro: не удалось загрузить контекст операции.')
      return sendEntryReply(ctx, voice ? voiceTimeZoneFailedReply : readError, messageId)
    }
    const parsed = await (
      typeof input === 'string'
        ? operationInput.parseText(input, context)
        : operationInput.parseAudio(input, context)
    ).catch(() => ({ ok: false as const, error: 'processor_unavailable' as const }))
    if (!parsed.ok) {
      return sendEntryReply(
        ctx,
        processorErrorReply(parsed, voice),
        messageId,
        'transcript' in parsed ? parsed.transcript : undefined,
      )
    }

    const { draft, categoryCandidates, dateConfirmation, transcript, rows } = parsed.result
    if (rows) {
      const preview = () => showBatch(ctx, rows, context, updateKey, messageId)
      return voice ? queueMessageUpdate(dateUpdateKey(ctx.chat!.id), preview) : preview()
    }
    const operation: TelegramOperationDraft = {
      amountKopecks: BigInt(draft.amountKopecks),
      description: draft.description,
      kind: draft.kind ?? undefined,
      operationDate: draft.operationDate ?? undefined,
      parsedInput: {
        text: typeof input === 'string' ? input : (transcript ?? ''),
        context,
        kind: draft.kind,
        candidates: categoryCandidates,
      },
    }
    if (dateConfirmation) {
      const confirm = () =>
        confirmOperationDate(ctx, operation, updateKey, dateConfirmation, messageId)
      // Text is already queued. Voice joins only after the audio has been parsed.
      return voice ? queueMessageUpdate(dateUpdateKey(ctx.chat!.id), confirm) : confirm()
    }
    return submitOperation(ctx, operation, updateKey, messageId, transcript)
  }

  bot.on('message:text', (ctx) => {
    const { text, date } = ctx.message
    if (text.startsWith('/')) return showHelp(ctx)
    const updateKey = `telegram:${ctx.update.update_id}`
    return queueMessageUpdate(dateUpdateKey(ctx.chat.id), () =>
      recordRemoteInput(ctx, text, updateKey, date),
    )
  })

  bot.on('message:voice', async (ctx) => {
    const { voice, message_id: messageId } = ctx.message
    if (voice.duration > maxVoiceSeconds || (voice.file_size ?? 0) > maxVoiceBytes) {
      return ctx.reply(voiceTooLongReply, mainKeyboard)
    }

    const progress = await ctx.reply(voiceTranscriptionProgressReply).catch(() => undefined)
    const progressId = progress?.message_id
    const updateKey = `${voiceKeyPrefix}${ctx.chat.id}:${messageId}`
    let file: File
    try {
      const audio = await fetchVoice(ctx.api, voice.file_id, AbortSignal.timeout(45_000))
      file = new File([audio], 'voice.ogg', { type: 'audio/ogg' })
    } catch {
      console.error('FinanceBro:', voiceDownloadFailedReply)
      return sendEntryReply(ctx, voiceDownloadFailedReply, progressId)
    }
    try {
      return await recordRemoteInput(ctx, file, updateKey, ctx.message.date, progressId)
    } catch {
      console.error('FinanceBro: не удалось завершить обработку голосового сообщения.')
      return sendEntryReply(ctx, voiceProcessingFailedReply, progressId)
    }
  })
}
