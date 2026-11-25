import type {
  StructuredOperationBatchRequest,
  StructuredOperationResult,
} from '../../packages/contracts/operations.ts'
import type { createInputClient } from './clients/input.ts'
import type { InputContext, ParseResult } from '../../packages/contracts/input.ts'
import type {
  OperationDraft,
  OperationInput,
  OperationKind,
  RecordOperationResult,
} from '../../packages/contracts/transactions.ts'

type InputClient = ReturnType<typeof createInputClient>

type OperationWriteResult =
  | { status: 'created'; id: string; kind: OperationKind; categoryName: string | null }
  | { status: 'duplicate' }
  | { status: 'category-unavailable' }
  | { status: 'date-invalid' }

export type TelegramOperationInput = {
  loadContext(telegramId: number): Promise<Omit<InputContext, 'sentAt' | 'kind'>>
  parseText: InputClient['parseText']
  parseAudio: InputClient['parseAudio']
  hasOperation(telegramId: number, idempotencyKey: string): Promise<boolean>
  recordOperation(
    telegramId: number,
    operation: OperationInput,
    categoryId: string | null,
    idempotencyKey: string,
  ): Promise<OperationWriteResult>
  setCategory(
    telegramId: number,
    operationId: string,
    categoryId: string | null,
  ): Promise<'updated' | 'category-unavailable' | 'unavailable'>
}

export type OperationSubmission =
  RecordOperationResult | { status: 'category-unavailable' } | { status: 'date-invalid' }

export type BatchSubmission =
  | { status: 'saved'; rows: StructuredOperationResult[] }
  | { status: 'category-unavailable' | 'date-invalid'; row: number }

export type TelegramInput = Pick<
  TelegramOperationInput,
  'loadContext' | 'parseText' | 'parseAudio' | 'setCategory'
> &
  Pick<InputClient, 'parseBudgetLimit' | 'parseDate'> & {
    submitBatch(request: StructuredOperationBatchRequest): Promise<BatchSubmission>
    submit(
      telegramId: number,
      operation: TelegramOperationDraft,
      updateKey: string,
    ): Promise<OperationSubmission>
  }

export type TelegramOperationDraft = OperationDraft & {
  parsedInput?: {
    text: string
    context: InputContext
    kind: OperationKind | null
    candidates: ParseResult['categoryCandidates']
    categoryId?: string | null
  }
}

export type OperationCategoryPrompt = {
  messageId: number
  telegramId: number
  expires: number
  updateKey: string
  operation: TelegramOperationDraft
  entries: ParseResult['categoryCandidates']
}

export async function recordParsedOperation(
  input: TelegramOperationInput,
  telegramId: number,
  operation: TelegramOperationDraft,
  updateKey: string,
): Promise<OperationSubmission> {
  const { kind, parsedInput, amountKopecks, description, operationDate } = operation
  if (!parsedInput) throw new Error('Missing parsed operation context')
  if (!kind) {
    return {
      status: (await input.hasOperation(telegramId, updateKey)) ? 'duplicate' : 'kind-required',
    }
  }

  let candidates = parsedInput.candidates
  if (parsedInput.kind !== kind) {
    const rematched = await input.parseText(parsedInput.text, { ...parsedInput.context, kind })
    if (!rematched.ok) throw new Error('Category matching failed')
    candidates = rematched.result.categoryCandidates
  }
  const choices = candidates.filter((candidate) => candidate.kind === kind)
  const categoryId =
    parsedInput.categoryId === undefined
      ? choices.length === 1
        ? choices[0]!.id
        : null
      : parsedInput.categoryId
  const result = await input.recordOperation(
    telegramId,
    { kind, amountKopecks, description, operationDate },
    categoryId,
    updateKey,
  )
  if (result.status === 'created' && parsedInput.categoryId === undefined && choices.length > 1) {
    return { ...result, categoryChoices: choices }
  }
  return result
}
