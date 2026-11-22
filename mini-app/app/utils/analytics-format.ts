const integerFormat = new Intl.NumberFormat('ru-RU')
const dayMonthFormat = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
})
const monthFormat = new Intl.DateTimeFormat('ru-RU', { month: 'long', timeZone: 'UTC' })

function calendarDate(date: string) {
  return new Date(`${date}T00:00:00Z`)
}

export function formatDay(date: string) {
  return dayMonthFormat.format(calendarDate(date))
}

export function formatDateRange(start: string, end: string) {
  const year = end.slice(0, 4)

  if (start === end) return `${formatDay(end)} ${year}`
  if (start.slice(0, 7) === end.slice(0, 7))
    return `${Number(start.slice(-2))}–${formatDay(end)} ${year}`
  const startYear = start.slice(0, 4)
  const startLabel = startYear === year ? formatDay(start) : `${formatDay(start)} ${startYear}`

  return `${startLabel} – ${formatDay(end)} ${year}`
}

export function formatMonthRange(start: string, end: string) {
  const startMonth = monthFormat.format(calendarDate(start))
  const startLabel = startMonth.charAt(0).toLocaleUpperCase('ru-RU') + startMonth.slice(1)
  if (start.slice(0, 7) === end.slice(0, 7)) return startLabel

  const endMonth = monthFormat.format(calendarDate(end))
  const endLabel = endMonth.charAt(0).toLocaleUpperCase('ru-RU') + endMonth.slice(1)
  const startYear = start.slice(0, 4)
  const endYear = end.slice(0, 4)
  return startYear === endYear
    ? `${startLabel} - ${endLabel}`
    : `${startLabel} ${startYear} - ${endLabel} ${endYear}`
}

export function formatKopecksAmount(value: string, showPlus = false) {
  const amount = BigInt(value)
  const absolute = amount < 0n ? -amount : amount
  const sign = amount < 0n ? '−' : amount > 0n && showPlus ? '+' : ''
  const rubles = integerFormat.format(absolute / 100n)
  const kopecks = absolute % 100n
  const fraction = kopecks === 0n ? '' : `,${String(kopecks).padStart(2, '0')}`

  return `${sign}${rubles}${fraction}`
}

export function formatKopecks(value: string, showPlus = false) {
  return `${formatKopecksAmount(value, showPlus)}\u00a0₽`
}
