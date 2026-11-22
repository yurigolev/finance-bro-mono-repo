const dateFormatters = new Map<string, Intl.DateTimeFormat>()

export function dateInZone(timeZone: string, instant = new Date()): string {
  let formatter = dateFormatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone,
    })
    dateFormatters.set(timeZone, formatter)
  }
  return formatter.format(instant)
}

export function adjacentDay(date: string, offset: number): string {
  const midnight = new Date(`${date}T00:00:00Z`)
  midnight.setUTCDate(midnight.getUTCDate() + offset)
  return midnight.toISOString().slice(0, 10)
}

export function adjacentMonth(month: string, offset: number): string {
  const date = new Date(`${month}-01T00:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() + offset)
  return date.toISOString().slice(0, 7)
}
