const dateFormat = new Intl.DateTimeFormat('ru-RU', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
})

export function formatOperationDate(date: string) {
  return dateFormat.format(new Date(`${date}T00:00:00Z`))
}
