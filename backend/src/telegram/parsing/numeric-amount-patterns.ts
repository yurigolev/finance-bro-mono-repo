const groupedRubles = String.raw`\d{1,3}(?:[ \u00a0\u202f]+\d{3})+`
const separator = String.raw`[\t \u00a0\u202f]+`
const thousands = String.raw`(?:[кk]|${separator}(?:тыс\.?|тысяч(?:а|и)?|тыщ(?:а|и)?))`
const amount = String.raw`(?<sign>[+\-−]?)(?<rubles>${groupedRubles}|\d+)(?:[.,](?<fraction>\d{1,2}))?(?<scale>${thousands})?`
export const amountFirst = new RegExp(`^${amount}${separator}(?<description>.+)$`, 'iu')
export const amountLast = new RegExp(`^(?<description>.+?)${separator}${amount}$`, 'iu')
export const amountOnly = new RegExp(`^${amount}$`, 'iu')
const numericToken = String.raw`\d+(?:[.,]\d+)?${thousands}?(?:\s|$)`
export const ambiguousDescription = new RegExp(
  String.raw`^[+\-−]?${numericToken}|\s[+\-−]${numericToken}`,
  'iu',
)
export const thousandsMarkerOnly = /^(?:тыс\.?|тысяч(?:а|и)?|тыщ(?:а|и)?)$/iu
export const endsInDetachedSign = /(?:^|\s)[+\-−]$/u
export const endsInWholeNumber = /\s\d+$/u
export const rubleGroupSeparatorPattern = /[ \u00a0\u202f]/gu
