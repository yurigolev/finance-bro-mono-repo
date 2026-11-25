import { session, type Context, type MiddlewareFn, type SessionFlavor } from 'grammy'
import type { OperationKind } from '../../packages/contracts/transactions.ts'
import type { BudgetPrompt } from './budgets/handlers.ts'
import type { OperationCategoryPrompt, TelegramOperationDraft } from './operation-input.ts'
import type { OperationBatchDraft } from './operations/entry/batch.ts'
import type { DateDraft } from './operations/date/dialog.ts'

export type KindPrompt = {
  telegramId: number
  messageId: number
  expires: number
  operation: TelegramOperationDraft
}

export type NameEdit = { kind: OperationKind; categoryId?: string }

export type TelegramSession = {
  budgetPrompt?: BudgetPrompt
  operationBatches?: Record<string, OperationBatchDraft>
  dateDrafts?: Record<string, DateDraft>
  operationKindPrompts?: Record<string, KindPrompt>
  operationCategoryPrompts?: Record<string, OperationCategoryPrompt>
  categoryNamePrompt?: { edit: NameEdit; messageId: number; settingsId: number; saving: boolean }
  builtInWordSearchPrompt?: { messageId: number; settingsId: number }
  settingsMessageId?: number
}

export type BotContext = Context & SessionFlavor<TelegramSession>

function getSessionKey(ctx: Context) {
  if (ctx.chat && ctx.from) return `${ctx.from.id}:${ctx.chat.id}`
}

function hasActiveState(value: TelegramSession) {
  const {
    operationBatches,
    dateDrafts,
    operationKindPrompts,
    operationCategoryPrompts,
    ...openState
  } = value
  const now = Date.now()
  return (
    Object.keys(openState).length > 0 ||
    Object.values(operationBatches ?? {}).some((draft) => draft.expires > now) ||
    Object.values(dateDrafts ?? {}).some((draft) => draft.expires > now) ||
    Object.values(operationKindPrompts ?? {}).some((prompt) => prompt.expires > now) ||
    Object.values(operationCategoryPrompts ?? {}).some((prompt) => prompt.expires > now)
  )
}

export function createTelegramSession(): MiddlewareFn<BotContext> {
  const sessions = new Map<string, { value: TelegramSession; pending: number }>()
  const attachSession = session<TelegramSession, BotContext>({
    getSessionKey,
    storage: {
      read: (key) => sessions.get(key)?.value,
      write(key, value) {
        sessions.get(key)!.value = value
      },
      delete(key) {
        sessions.get(key)!.value = {}
      },
    },
  })

  return async (ctx, next) => {
    const key = getSessionKey(ctx)
    if (key === undefined) return next()

    // Allocate before grammY's async read so overlapping updates share even a new session.
    const entry = sessions.get(key) ?? { value: {}, pending: 0 }
    sessions.set(key, entry)
    entry.pending++
    try {
      await attachSession(ctx, next)
    } finally {
      if (--entry.pending === 0 && !hasActiveState(entry.value)) sessions.delete(key)
    }
  }
}
