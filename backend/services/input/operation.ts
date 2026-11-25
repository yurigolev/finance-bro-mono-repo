import type {
  ClarificationRequest,
  ClarificationResult,
  ParseError,
} from '../../packages/contracts/input.ts'
import type { OperationDraft } from '../../packages/contracts/transactions.ts'
import { dateInZone } from '../../packages/shared/calendar.ts'
import { hasOperationDate, parseOperationDate } from './parsing/operation-date.ts'
import { parseAmountInDescription, parseBareAmount } from './parsing/message-operations.ts'
import { parseBudgetAmount, parseOperation } from './parsing/parser.ts'

export function parseClarification(answer: ClarificationRequest): ClarificationResult | ParseError {
  if (answer.kind === 'budget-limit') {
    const amount = parseBudgetAmount(answer.text)
    return amount === null ? { error: 'unrecognized' } : { amountKopecks: amount.toString() }
  }

  const parsed = parseOperationDate(answer.text.trim(), answer.today)
  if (parsed.kind === 'error') return { error: 'invalid_date', message: parsed.message }
  if (parsed.kind !== 'date' || parsed.text) return { error: 'unrecognized' }
  if (parsed.dates.length > 1) {
    return { status: 'clarification-required', dates: parsed.dates }
  }
  return {
    status: 'resolved',
    draft: {
      ...answer.draft,
      operationDate: { date: parsed.dates[0]!, timeZone: answer.timeZone },
    },
  }
}

const standaloneAmountPattern = /(?<![\p{L}\p{N}/])[-+−]?\d+(?:[.,]\d+)?(?![\p{L}\p{N}/])/u

export type DateConfirmation = { dates: string[]; today: string; timeZone: string }
type ParsedOperationInput =
  | { status: 'parsed'; draft: OperationDraft; dateConfirmation?: DateConfirmation }
  | { status: 'unrecognized' }
  | { status: 'invalid_date'; message: string }

export function parseOperationInput(
  text: string,
  { sentAt, timeZone }: { sentAt: string; timeZone: string },
  allowBareSpoken = false,
): ParsedOperationInput {
  const parseDraft = (part: string) =>
    (allowBareSpoken ? parseBareAmount(part) : null) ??
    (/коп(?:еек|ейки|ейка|\.)/iu.test(part) ? parseAmountInDescription(part) : null) ??
    parseOperation(part) ??
    parseAmountInDescription(part)
  if (!hasOperationDate(text)) {
    const draft = parseDraft(text)
    return draft ? { status: 'parsed', draft } : { status: 'unrecognized' }
  }

  const today = dateInZone(timeZone, new Date(sentAt))
  const parsed = parseOperationDate(text, today, (part) => parseDraft(part)?.description)
  if (parsed.kind === 'none') return { status: 'unrecognized' }
  const draft = parsed.text ? parseDraft(parsed.text) : null

  if (parsed.shortNumeric && !draft) {
    const decimalAmount = parseOperation(text)
    if (decimalAmount) return { status: 'parsed', draft: decimalAmount }
  }
  if (parsed.kind === 'error') return { status: 'invalid_date', message: parsed.message }
  if (
    !draft ||
    (standaloneAmountPattern.test(draft.description) && !parseAmountInDescription(parsed.text))
  )
    return { status: 'unrecognized' }
  if (parsed.confirm) {
    return { status: 'parsed', draft, dateConfirmation: { dates: parsed.dates, today, timeZone } }
  }

  return {
    status: 'parsed',
    draft: { ...draft, operationDate: { date: parsed.dates[0], timeZone } },
  }
}
