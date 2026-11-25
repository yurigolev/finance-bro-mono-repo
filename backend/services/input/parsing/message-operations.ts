import { maxOperationBatchSize } from '../../../packages/contracts/operations.ts'
import { datePattern } from './operation-date-patterns.ts'
import {
  amount,
  amountConnector,
  operationPrefix,
  unsupportedWords,
} from './spoken-amount-patterns.ts'
import { parseOperation } from './parser.ts'
import { normalizeSpokenAmount } from './spoken-amount.ts'

const approximate = /(?<!\p{L})(?:около|примерно|приблизительно|порядка|~)\s*$/iu
const rangeStart = /(?<!\p{L})(?:от|между)\s+$/iu
const rangeEnd = /^\s+(?:до|и)\s+$/iu
const options = /^\s*[,;]?\s*или\s+$/iu
const correction = /^[\s,.…:;—-]*(?:нет|ой[,\s]+точнее|точнее|вернее)[\s,.…:;—-]+$/iu
const separator = /[,.!?;…\n]\s*(?:и\s+)?|\s+и\s+|^\s+(?=ещ[её]\s+)/iu
const caseInsensitiveAmount = new RegExp(amount, 'giu')
const caseInsensitiveDate = new RegExp(datePattern, 'giu')
const additional = /(?<!\p{L})ещ[её]\s+/iu
const quantityUnit =
  /^\s+(?:чаш\p{L}*|стакан\p{L}*|штук\p{L}*|порци\p{L}*|кг|грамм\p{L}*|литр\p{L}*)(?!\p{L})/iu
const closing = /^[\s.!?…]+$/u
const cleanEdges = /^[\s,;.!?…]+|[\s,;.!?…]+$/gu

function amountSpans(text: string) {
  const dates = [...text.matchAll(caseInsensitiveDate)].filter(
    (match) => !/^\d{1,2}\.\d{1,2}$/u.test(match[0]),
  )
  return [...text.matchAll(caseInsensitiveAmount)].flatMap((match) => {
    const start = match.index
    const end = start + match[0].length
    if (text[start - 1] === '/' || text[end] === '/') return []
    if (
      dates.some((date) => start < date.index + date[0].length && end > date.index) ||
      (!match.groups?.unit &&
        (quantityUnit.test(text.slice(end)) ||
          (/^(?:один|одна|одно)$/iu.test(match[0]) && /^\s+\p{L}/u.test(text.slice(end)))))
    ) {
      return []
    }
    const sign = /[+−-]\s*$/u.exec(text.slice(0, start))
    return [{ start: sign?.index ?? start, end }]
  })
}

function parseExactAmount(text: string) {
  const sign = /^[+−-]\s*/u.exec(text)?.[0] ?? ''
  const normalized = normalizeSpokenAmount(`${text.slice(sign.length)} операция`)
  return normalized ? parseOperation(sign + normalized) : null
}

export function parseBareAmount(text: string) {
  const trimmed = text.trim()
  const [span] = amountSpans(trimmed)
  if (!span || span.start !== 0 || span.end !== trimmed.length) return null
  const parsed = parseExactAmount(trimmed)
  return parsed && { ...parsed, description: '' }
}

export function parseAmountInDescription(text: string) {
  const spans = amountSpans(text)
  if (spans.length !== 1) return null
  const [{ start, end }] = spans
  const parsed = parseExactAmount(text.slice(start, end))
  if (!parsed) return null

  const before = text.slice(0, start).trim().replace(operationPrefix, '')
  const prefix = before.replace(amountConnector, '').trim()
  const suffix = text
    .slice(end)
    .trim()
    .replace(/^(?:на|за)\s+/iu, '')
  const description = [prefix, suffix].filter(Boolean).join(' ').replace(cleanEdges, '')
  if (description.length > 200 || unsupportedWords.test(description) || !/\p{L}/u.test(description))
    return null
  return { ...parsed, description }
}

export function splitOperationMessage(input: string) {
  let text = input.trim().replace(/[^\S\n]/gu, ' ')
  let spans = amountSpans(text)
  const ambiguous = spans.some(({ start, end }, index) => {
    const before = text.slice(0, start)
    if (approximate.test(before)) return true
    const next = spans[index + 1]
    if (!next) return false
    const between = text.slice(end, next.start)
    const startsWithDash = /^-/u.test(text.slice(next.start))
    return (
      options.test(between) ||
      (rangeStart.test(before) && rangeEnd.test(between)) ||
      /^\s*[–—-]\s*$/u.test(between) ||
      (startsWithDash && /^\s*$/u.test(between))
    )
  })
  if (ambiguous) return null

  for (let index = 1; index < spans.length; index++) {
    const previous = spans[index - 1]!
    const current = spans[index]!
    if (!correction.test(text.slice(previous.end, current.start))) continue
    const tail = text.slice(current.end)
    if (tail && !closing.test(tail) && (!spans[index + 1] || separator.exec(tail)?.index !== 0)) {
      return null
    }
    const replacement = text.slice(current.start, current.end)
    const sign = /^[+−-]/u.test(replacement)
      ? ''
      : (/^[+−-]/u.exec(text.slice(previous.start))?.[0] ?? '')
    text = text.slice(0, previous.start) + sign + replacement + tail
    spans = amountSpans(text)
    index--
  }

  if (spans.length <= 1) return [{ text, extra: false }]
  if (spans.length > maxOperationBatchSize) return null
  const rows: { text: string; extra: boolean }[] = []
  let start = 0
  let extra = false
  for (let index = 1; index < spans.length; index++) {
    const previous = spans[index - 1]!
    const current = spans[index]!
    const gap = text.slice(previous.end, current.start)
    const boundary = separator.exec(gap)
    if (!boundary && !gap.trim()) return null
    const left = boundary ? previous.end + boundary.index : previous.end
    rows.push({ text: text.slice(start, left).replace(cleanEdges, ''), extra })
    start = boundary ? left + boundary[0].length : previous.end
    const after = text.slice(start, current.start)
    extra = additional.test(after)
  }
  rows.push({ text: text.slice(start).replace(cleanEdges, ''), extra })
  return rows.map((row) => (row.extra ? { ...row, text: row.text.replace(additional, '') } : row))
}
