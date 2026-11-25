import { adjacentDay } from '../../../packages/shared/calendar.ts'
import {
  dateEdgeSeparatorPattern,
  dateHorizontalSpacePattern,
  datePattern,
  datePrepositionPattern,
  fourDigitYearPattern,
  integerPattern,
  isoYearPrefixPattern,
  leadingCommaPattern,
  leadingDigitPattern,
  months,
  nextWeekdayPattern,
  ordinals,
  repeatedHorizontalSpacePattern,
  shortNumericDatePattern,
  spokenYearAffixPattern,
  trailingCommaPattern,
  weekdays,
} from './operation-date-patterns.ts'

const relativeDays = new Map([
  ['позавчера', -2],
  ['вчера', -1],
  ['сегодня', 0],
  ['завтра', 1],
  ['послезавтра', 2],
])
const agoWords = [
  'один',
  'два',
  'три',
  'четыре',
  'пять',
  'шесть',
  'семь',
  'восемь',
  'девять',
  'десять',
]

type Candidate = { date: string; kind: 'absolute' | 'relative' | 'weekday'; confirm: boolean }
type DateInput =
  | { kind: 'none'; text: string }
  | { kind: 'error'; message: string; shortNumeric?: boolean; text?: string }
  | { kind: 'date'; text: string; dates: string[]; confirm: boolean; shortNumeric: boolean }

export const invalidDate = 'Такой даты нет. Введите дату, например 18 ноября.'
export const futureDate = 'Дата в будущем. Выберите сегодня или прошлый день.'

function civilDate(year: number, month: number, day: number): string | null {
  if (year < 1000 || year > 9999) return null
  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const parsed = new Date(`${date}T00:00:00Z`)
  return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === date ? date : null
}

function ordinalNumber(value: string): number {
  if (integerPattern.test(value)) return Number(value)
  if (value.startsWith('двадцать ')) return 21 + ordinals.indexOf(value.slice(9))
  if (value === 'тридцатого') return 30
  if (value === 'тридцать первого') return 31
  return 1 + ordinals.indexOf(value)
}

function yearNumber(value: string): number {
  if (leadingDigitPattern.test(value)) return Number.parseInt(value, 10)
  const rest = value.replace(spokenYearAffixPattern, '')
  return 2000 + (rest ? ordinalNumber(rest) : 0)
}

function resolveDate(fields: Record<string, string>, today: string): Candidate | string {
  if (fields.range) {
    return nextWeekdayPattern.test(fields.range)
      ? futureDate
      : 'Укажите конкретный день, например 18 ноября.'
  }
  if (fields.relative || fields.ago) {
    const offset = fields.relative
      ? relativeDays.get(fields.relative)!
      : -(integerPattern.test(fields.ago)
          ? Number(fields.ago)
          : fields.ago === 'две'
            ? 2
            : agoWords.indexOf(fields.ago) + 1)
    if (offset > 0) return futureDate
    if (offset < -3_287_000) return invalidDate
    const date = adjacentDay(today, offset)
    if (!isoYearPrefixPattern.test(date) || date < '1000-01-01') return invalidDate
    return { kind: 'relative', date, confirm: false }
  }
  if (fields.weekday) {
    const weekday = weekdays.indexOf(fields.weekday)
    const current = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7
    const offset = fields.last ? weekday - current - 7 : -((current - weekday + 7) % 7)
    return { kind: 'weekday', date: adjacentDay(today, offset), confirm: true }
  }

  let day: number
  let month: number
  let year: number | undefined
  if (fields.iso) {
    ;[year, month, day] = fields.iso.split('-').map(Number) as [number, number, number]
  } else if (fields.numeric) {
    ;[day, month, year] = fields.numeric.split('.').map(Number) as [number, number, number?]
    if (year !== undefined && fields.numeric.split('.').at(-1)!.length === 2) {
      return 'Проверьте формат даты. Например, 18 ноября.'
    }
  } else {
    day = ordinalNumber(fields.day)
    month = months.indexOf(fields.month) + 1
    year = fields.year ? yearNumber(fields.year) : undefined
  }

  const currentYear = Number(today.slice(0, 4))
  if (year !== undefined) {
    const date = civilDate(year, month, day)
    if (!date) return invalidDate
    if (date > today) return futureDate
    return { kind: 'absolute', date, confirm: false }
  }

  if (!civilDate(2000, month, day)) return invalidDate
  // A date without a year can be a leap day. Search back through a non-leap century.
  for (let candidate = currentYear; candidate >= currentYear - 8; candidate--) {
    const date = civilDate(candidate, month, day)
    if (date && date <= today) return { kind: 'absolute', date, confirm: true }
  }
  return invalidDate
}

function removeDates(input: string, matches: RegExpMatchArray[], keepBareYear = false): string {
  let text = input
  for (const match of matches.toReversed()) {
    const start = match.index!
    const before = text
      .slice(0, start)
      .replace(datePrepositionPattern, '')
      .replace(trailingCommaPattern, '')
    const year = match.groups?.year
    const length =
      keepBareYear && isBareYear(year) ? match[0].length - year.length : match[0].length
    const after = text.slice(start + length).replace(leadingCommaPattern, '')
    text = `${before} ${after}`
  }
  return text
    .trim()
    .replace(dateEdgeSeparatorPattern, '')
    .replace(repeatedHorizontalSpacePattern, ' ')
}

function isBareYear(year?: string): year is string {
  return year !== undefined && fourDigitYearPattern.test(year)
}

function normalizeDateInput(input: string): string {
  return input.toLowerCase().replaceAll('ё', 'е').replace(dateHorizontalSpacePattern, ' ')
}

export function parseOperationDate(
  input: string,
  today: string,
  parseOperation?: (text: string) => unknown,
): DateInput {
  const matches = [...normalizeDateInput(input).matchAll(datePattern)]
  if (!matches.length) return { kind: 'none', text: input }
  const shortNumeric = matches.length === 1 && shortNumericDatePattern.test(matches[0]![0])
  let text = removeDates(input, matches)
  let keepBareYear = false
  // “18 ноября 4800 кофе” has a four-digit amount where a standalone year could appear.
  if (
    parseOperation &&
    matches.some(({ groups }) => isBareYear(groups?.year)) &&
    !parseOperation(text)
  ) {
    const alternative = removeDates(input, matches, true)
    if (parseOperation(alternative)) {
      text = alternative
      keepBareYear = true
    }
  }
  const candidates: Candidate[] = []
  for (const { groups } of matches) {
    const fields = groups!
    const result = resolveDate(
      keepBareYear && isBareYear(fields.year) ? { ...fields, year: '' } : fields,
      today,
    )
    if (typeof result === 'string') return { kind: 'error', message: result, shortNumeric, text }
    candidates.push(result)
  }
  const dates = [...new Set(candidates.map(({ date }) => date))]
  const weekdayAndDate =
    candidates.length === 2 &&
    candidates.some(({ kind }) => kind === 'weekday') &&
    candidates.some(({ kind }) => kind === 'absolute')
  if (dates.length > 1 && !weekdayAndDate) {
    return { kind: 'error', message: 'В сообщении несколько дат. Укажите один день на операцию.' }
  }
  return {
    kind: 'date',
    text,
    dates,
    shortNumeric,
    confirm: candidates.some(({ confirm }) => confirm),
  }
}

export function hasOperationDate(input: string): boolean {
  return normalizeDateInput(input).match(datePattern) !== null
}
