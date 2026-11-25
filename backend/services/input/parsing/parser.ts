import type { OperationDraft } from '../../../packages/contracts/transactions.ts'
import { normalizeSpokenAmount } from './spoken-amount.ts'
import {
  ambiguousDescription,
  amountFirst,
  amountLast,
  amountOnly,
  endsInDetachedSign,
  endsInWholeNumber,
  rubleGroupSeparatorPattern,
  thousandsMarkerOnly,
} from './numeric-amount-patterns.ts'

const maxKopecks = 9_223_372_036_854_775_807n

function toKopecks(rubleDigits: string, fraction: string, scale?: string): bigint | null {
  const hundredths = BigInt(rubleDigits) * 100n + BigInt(fraction.padEnd(2, '0'))
  const kopecks = scale ? hundredths * 1_000n : hundredths
  return kopecks === 0n || kopecks > maxKopecks ? null : kopecks
}

export function parseBudgetAmount(text: string): bigint | null {
  const fields = amountOnly.exec(text.trim())?.groups
  if (!fields || fields.sign) return null
  return toKopecks(
    fields.rubles.replace(rubleGroupSeparatorPattern, ''),
    fields.fraction ?? '',
    fields.scale,
  )
}

export function parseOperation(text: string): OperationDraft | null {
  const operation = parseNumericOperation(text)
  if (operation) return operation
  const normalized = normalizeSpokenAmount(text)
  return normalized === null ? null : parseNumericOperation(normalized)
}

function parseNumericOperation(text: string): OperationDraft | null {
  const input = text.trim()
  const prefix = amountOnly.exec(input) ?? amountFirst.exec(input)
  const fields = (prefix ?? amountLast.exec(input))?.groups
  if (!fields) return null

  const { sign, rubles, fraction = '', scale } = fields
  const rubleDigits = rubles.replace(rubleGroupSeparatorPattern, '')
  const description = fields.description?.trim() ?? ''
  if (description.length > 200 || ambiguousDescription.test(description)) return null
  if (prefix && !scale && thousandsMarkerOnly.test(description)) return null
  // Reject a partial match at the end of a malformed grouped amount, such as “40 50 000”.
  if (
    !prefix &&
    (endsInDetachedSign.test(description) ||
      (!sign &&
        (rubles.length <= 3 || rubles !== rubleDigits) &&
        endsInWholeNumber.test(description)))
  )
    return null

  const amountKopecks = toKopecks(rubleDigits, fraction, scale)
  if (amountKopecks === null) return null

  const operation: OperationDraft = { amountKopecks, description }
  if (sign) operation.kind = sign === '+' ? 'income' : 'expense'
  return operation
}
