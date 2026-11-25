export const weekdays = [
  'понедельник',
  'вторник',
  'среду',
  'четверг',
  'пятницу',
  'субботу',
  'воскресенье',
]
export const months = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
]
export const ordinals = [
  'первого',
  'второго',
  'третьего',
  'четвертого',
  'пятого',
  'шестого',
  'седьмого',
  'восьмого',
  'девятого',
  'десятого',
  'одиннадцатого',
  'двенадцатого',
  'тринадцатого',
  'четырнадцатого',
  'пятнадцатого',
  'шестнадцатого',
  'семнадцатого',
  'восемнадцатого',
  'девятнадцатого',
  'двадцатого',
]
const ordinal = `(?:двадцать (?:${ordinals.slice(0, 9).join('|')})|тридцать первого|тридцатого|${ordinals.join('|')})`
const namedDay = `(?:[0-9]{1,2}|${ordinal})`
const spokenYear = `две тысячи(?: ${ordinal})?`
const namedYear = `(?:[0-9]{4}(?: года)?|${spokenYear} года)`
const absolutePattern = `(?<iso>[0-9]{4}-[0-9]{1,2}-[0-9]{1,2})|(?<numeric>[0-9]{1,2}\\.[0-9]{1,2}(?:\\.[0-9]{2,4})?)(?![.,][0-9])|(?<day>${namedDay}) (?<month>${months.join('|')})(?: (?<year>${namedYear})(?![\\p{L}\\p{N}]))?`
const relativePattern =
  '(?<relative>позавчера|вчера|сегодня|завтра|послезавтра)|(?<ago>[0-9]+|один|два|две|три|четыре|пять|шесть|семь|восемь|девять|десять) (?:день|дня|дней) назад'
const weekdayPattern = `(?:в|во) (?:(?<last>прошл(?:ый|ую|ое)) )?(?<weekday>${weekdays.join('|')})`
const rangePattern =
  '(?:на прошлой неделе|в начале месяца|в конце месяца|на выходных|на этой неделе|(?:в|во) следующ(?:ий|ую|ее) (?:' +
  weekdays.join('|') +
  '))'
export const datePattern = new RegExp(
  `(?<![\\p{L}\\p{N}./-])(?:${absolutePattern}|${relativePattern}|${weekdayPattern}|(?<range>${rangePattern}))(?![\\p{L}\\p{N}/-])`,
  'gu',
)
export const integerPattern = /^\d+$/u
export const leadingDigitPattern = /^\d/u
export const spokenYearAffixPattern = /^две тысячи ?| ?года$/gu
export const nextWeekdayPattern = /^в(?:о)? следующ/u
export const isoYearPrefixPattern = /^\d{4}-/u
export const datePrepositionPattern = /(?<![\p{L}\p{N}])(?:от|за) +$/iu
export const trailingCommaPattern = /[ \t]*,[ \t]*$/u
export const leadingCommaPattern = /^[ \t]*,[ \t]*/u
export const dateEdgeSeparatorPattern = /^[,\s]+|[,\s]+$/gu
export const repeatedHorizontalSpacePattern = /[ \t]{2,}/gu
export const fourDigitYearPattern = /^\d{4}$/u
export const dateHorizontalSpacePattern = /[^\S\r\n]/gu
export const shortNumericDatePattern = /^\d{1,2}\.\d{1,2}$/u
