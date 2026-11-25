import type { TelegramOperationDraft } from '../../operation-input.ts'

export type DateDraft = {
  token: string
  telegramId: number
  revision: number
  expires: number
  messageId?: number
  promptId?: number
  photo?: boolean
  operation: TelegramOperationDraft
  originalDate?: string
  dates: string[]
  choosing: boolean
  timeZone: string
  today: string
  target: { updateKey: string } | { operationId: string }
}

export function dateUpdateKey(chatId: number) {
  return `${chatId}:dates`
}

export function updateDraftSelection(draft: DateDraft, dates?: string[]) {
  if (dates !== undefined) draft.dates = dates
  draft.choosing = dates === undefined
  draft.promptId = undefined
  draft.revision++
}
