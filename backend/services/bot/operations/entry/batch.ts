import { randomBytes } from 'node:crypto'
import { InlineKeyboard, type Composer } from 'grammy'
import type { InputContext, ParsedOperationRow } from '../../../../packages/contracts/input.ts'
import type { OperationKind } from '../../../../packages/contracts/transactions.ts'
import { matchOperationCategories } from '../../../../packages/shared/categories/matching.ts'
import type { BotContext } from '../../context.ts'
import type { QueueMessageUpdate } from '../../dependencies.ts'
import type { TelegramInput } from '../../operation-input.ts'
import {
  compactUuid,
  escapeHtml,
  expandUuid,
  formatAmount,
  isMissingEditableMessage,
  pagedButtons,
  sendCompactScreen,
  unavailable,
} from '../../ui.ts'
import { dateUpdateKey } from '../date/dialog.ts'
import { formatOperationDate } from '../date/format.ts'
import { operationCancelledScreen } from './screen.ts'

type BatchRow = ParsedOperationRow & { categoryId?: string | null }

export type OperationBatchDraft = {
  updateKey: string
  context: InputContext
  messageId: number
  expires: number
  rows: BatchRow[]
  edit?: { index: number; messageId: number }
  saved?: boolean
  savePending?: boolean
}

const action =
  /^ob:([A-Za-z0-9_-]{12}):(save|cancel|back|row|kind|category|page|edit)(?::(\d{1,2}))?(?::(income|expense|none|\d{1,4}|[A-Za-z0-9_-]{22}))?$/u
const draftLifetime = 30 * 60_000

function toBatchRow(row: ParsedOperationRow): BatchRow {
  const matches = row.categoryCandidates.filter(({ kind }) => kind === row.draft.kind)
  return {
    ...row,
    categoryId: matches.length === 1 ? matches[0]!.id : matches.length ? undefined : null,
  }
}

function describe({ draft, categoryCandidates, categoryId }: BatchRow) {
  const type = draft.kind === 'income' ? '+' : draft.kind === 'expense' ? '−' : ''
  const amount = type + formatAmount(BigInt(draft.amountKopecks), true)
  const category = categoryId
    ? categoryCandidates.find(({ id }) => id === categoryId)?.name
    : categoryId === null
      ? 'Без категории'
      : 'Выберите категорию'
  return [
    `<b>${amount}</b>`,
    draft.description && escapeHtml(draft.description),
    draft.operationDate && escapeHtml(formatOperationDate(draft.operationDate.date)),
    draft.kind ? category && escapeHtml(category) : 'Выберите тип операции',
  ]
    .filter(Boolean)
    .join(' · ')
}

function batchScreen(batch: OperationBatchDraft, token: string, index?: number, page = 0) {
  const prefix = `ob:${token}:`
  const keyboard = new InlineKeyboard()
  if (index !== undefined) {
    const row = batch.rows[index]!
    keyboard
      .text('Расход', `${prefix}kind:${index}:expense`)
      .text('Доход', `${prefix}kind:${index}:income`)
      .row()
    if (row.draft.kind) {
      const buttons = pagedButtons(
        row.categoryCandidates,
        page,
        ({ id }) => `${prefix}category:${index}:${compactUuid(id)}`,
        (nextPage) => `${prefix}page:${index}:${nextPage}`,
      )
      keyboard.inline_keyboard.push(...buttons)
      keyboard.text('Без категории', `${prefix}category:${index}:none`).row()
    }
    keyboard.text('Изменить сумму или описание', `${prefix}edit:${index}`).row()
    keyboard.text('К списку', `${prefix}back`)
    return {
      html: `<b>Операция ${index + 1}</b>\n${describe(row)}`,
      keyboard: { reply_markup: keyboard },
    }
  }

  for (const [rowIndex, row] of batch.rows.entries()) {
    const label = !row.draft.kind
      ? 'Выбрать тип'
      : row.categoryId === undefined
        ? 'Выбрать категорию'
        : 'Изменить'
    keyboard.text(`${label} · ${rowIndex + 1}`, `${prefix}row:${rowIndex}`)
    if (rowIndex % 2 === 1) keyboard.row()
  }
  keyboard.row()
  if (batch.rows.every((row) => row.draft.kind && row.categoryId !== undefined)) {
    keyboard.text(`Записать (${batch.rows.length})`, `${prefix}save`)
  }
  keyboard.text('Отмена', `${prefix}cancel`)
  return {
    html: [
      '<b>Черновик операций</b>',
      ...batch.rows.map((row, rowIndex) => `${rowIndex + 1}. ${describe(row)}`),
    ].join('\n'),
    keyboard: { reply_markup: keyboard },
  }
}

export function registerOperationBatch(
  bot: Composer<BotContext>,
  operationInput: TelegramInput,
  queueMessageUpdate: QueueMessageUpdate,
) {
  bot.callbackQuery(action, (ctx) =>
    queueMessageUpdate(dateUpdateKey(ctx.chat!.id), async () => {
      const [, token, command, rowIndex, value] = ctx.match
      const batches = ctx.session.operationBatches
      const batch = batches?.[token!]
      if (!batch || batch.messageId !== ctx.msgId || batch.expires <= Date.now()) {
        return ctx.answerCallbackQuery({ text: unavailable })
      }
      if (batch.saved) return ctx.answerCallbackQuery({ text: 'Операции уже записаны.' })
      if (batch.savePending && command !== 'save') {
        return ctx.answerCallbackQuery({ text: 'Повторите запись, чтобы проверить результат.' })
      }
      const index = Number(rowIndex)
      const row = batch.rows[index]
      switch (command) {
        case 'cancel':
          delete batches![token!]
          await sendCompactScreen(ctx, operationCancelledScreen, batch.messageId)
          break
        case 'back':
          delete batch.edit
          await sendCompactScreen(ctx, batchScreen(batch, token!), batch.messageId)
          break
        case 'row':
        case 'page':
          if (!row) return ctx.answerCallbackQuery({ text: unavailable })
          await sendCompactScreen(
            ctx,
            batchScreen(batch, token!, index, Number(value ?? 0)),
            batch.messageId,
          )
          break
        case 'kind': {
          if (!row || (value !== 'expense' && value !== 'income')) {
            return ctx.answerCallbackQuery({ text: unavailable })
          }
          const { categoryCandidates } = matchOperationCategories(batch.context, {
            description: row.draft.description,
            kind: value,
          })
          batch.rows[index] = toBatchRow({
            ...row,
            draft: { ...row.draft, kind: value },
            categoryCandidates,
          })
          await sendCompactScreen(ctx, batchScreen(batch, token!, index), batch.messageId)
          break
        }
        case 'category': {
          const categoryId = value?.length === 22 ? expandUuid(value) : undefined
          const choice = row?.categoryCandidates.find(({ id }) => id === categoryId)
          if (!row?.draft.kind || (value !== 'none' && choice?.kind !== row.draft.kind)) {
            return ctx.answerCallbackQuery({ text: unavailable })
          }
          row.categoryId = value === 'none' ? null : choice!.id
          await sendCompactScreen(ctx, batchScreen(batch, token!), batch.messageId)
          break
        }
        case 'edit': {
          if (!row) return ctx.answerCallbackQuery({ text: unavailable })
          const prompt = await ctx.reply(
            `Введите операцию ${index + 1} заново. Например, «кофе 250».`,
            {
              reply_markup: { force_reply: true, selective: true },
            },
          )
          batch.edit = { index, messageId: prompt.message_id }
          break
        }
        case 'save': {
          if (batch.rows.some((item) => !item.draft.kind || item.categoryId === undefined)) {
            return ctx.answerCallbackQuery({ text: unavailable })
          }
          const result = await operationInput
            .submitBatch({
              telegramUserId: ctx.from.id,
              idempotencyKey: batch.updateKey,
              rows: batch.rows.map(({ draft, categoryId }) => ({
                ...draft,
                kind: draft.kind as OperationKind,
                categoryId: categoryId!,
                operationDate: draft.operationDate ?? undefined,
              })),
            })
            .catch(() => null)
          batch.savePending = !result
          if (!result) {
            return ctx.answerCallbackQuery({
              text: 'Не удалось проверить запись. Нажмите «Записать» ещё раз.',
              show_alert: true,
            })
          }
          if (result.status !== 'saved') {
            const failed = batch.rows[result.row]
            if (result.status === 'category-unavailable' && failed) {
              const refreshed = await operationInput.loadContext(ctx.from.id).catch(() => null)
              if (refreshed && failed.draft.kind) {
                batch.context = { ...batch.context, ...refreshed, timeZone: batch.context.timeZone }
                const { categoryCandidates } = matchOperationCategories(batch.context, {
                  description: failed.draft.description,
                  kind: failed.draft.kind,
                })
                batch.rows[result.row] = toBatchRow({ ...failed, categoryCandidates })
              }
              await sendCompactScreen(ctx, batchScreen(batch, token!, result.row), batch.messageId)
            }
            return ctx.answerCallbackQuery({
              text:
                result.status === 'category-unavailable'
                  ? 'Категория недоступна. Проверьте строку.'
                  : 'Проверьте дату операции.',
              show_alert: true,
            })
          }
          batch.saved = true
          const html = `<b>Записано операций: ${result.rows.length}</b>\nЗаписи доступны в истории.`
          await sendCompactScreen(
            ctx,
            { html, keyboard: { reply_markup: new InlineKeyboard() } },
            batch.messageId,
          )
          break
        }
      }
      return ctx.answerCallbackQuery()
    }),
  )

  bot.on('message:text', (ctx, next) => {
    const messageId = ctx.message.reply_to_message?.message_id
    if (messageId === undefined) return next()
    const match = Object.entries(ctx.session.operationBatches ?? {}).find(
      ([, batch]) =>
        !batch.saved && batch.expires > Date.now() && batch.edit?.messageId === messageId,
    )
    if (!match) return next()
    const [token, batch] = match
    return queueMessageUpdate(dateUpdateKey(ctx.chat.id), async () => {
      if (
        batch.saved ||
        batch.savePending ||
        batch.edit?.messageId !== messageId ||
        ctx.session.operationBatches?.[token] !== batch
      )
        return
      const parsed = await operationInput
        .parseText(ctx.message.text, batch.context)
        .catch(() => null)
      if (
        !parsed?.ok ||
        parsed.result.rows ||
        (parsed.result.dateConfirmation?.dates.length ?? 0) > 1
      ) {
        return ctx.reply('Введите одну операцию с точной суммой в ответ на сообщение бота.')
      }
      const index = batch.edit.index
      const { draft } = parsed.result
      const operationDate = draft.operationDate ?? batch.rows[index]!.draft.operationDate
      batch.rows[index] = toBatchRow({ ...parsed.result, draft: { ...draft, operationDate } })
      delete batch.edit
      await sendCompactScreen(ctx, batchScreen(batch, token), batch.messageId)
    })
  })

  return async (
    ctx: BotContext,
    rows: ParsedOperationRow[],
    context: InputContext,
    updateKey: string,
    messageId?: number,
  ) => {
    const batches = (ctx.session.operationBatches ??= {})
    for (const [token, batch] of Object.entries(batches)) {
      if (batch.expires <= Date.now()) delete batches[token]
    }
    if (Object.values(batches).some((batch) => batch.updateKey === updateKey)) return
    const token = randomBytes(9).toString('base64url')
    const batch = {
      updateKey,
      context,
      messageId: 0,
      expires: Date.now() + draftLifetime,
      rows: rows.map(toBatchRow),
    }
    const screen = batchScreen(batch, token)
    const sent = await sendCompactScreen(ctx, screen, messageId).catch((error: unknown) => {
      if (!isMissingEditableMessage(error)) throw error
      return sendCompactScreen(ctx, screen)
    })
    const previewId = typeof sent === 'object' ? sent.message_id : messageId
    if (previewId === undefined) return
    batches[token] = { ...batch, messageId: previewId }
  }
}
