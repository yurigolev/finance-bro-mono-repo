import {
  amount,
  amountConnector,
  descriptionPrepositionPattern,
  detachedMinusPattern,
  edgePunctuation,
  groupedWholeRublesPattern,
  kopeckDigitsPattern,
  leadingDigitPattern,
  letterPattern,
  numberWords,
  operationPrefix,
  spacedThousandsSuffixPattern,
  thousandsAtEnd,
  thousandsWord,
  unsupportedCurrencyOrPlusPattern,
  unsupportedWords,
  whitespacePattern,
} from './spoken-amount-patterns.ts'

function spokenGroup(words: string[]): number | null {
  let total = 0
  let previousRank = 3
  for (const word of words) {
    const value = numberWords.get(word)
    if (value === undefined || (value === 0 && words.length > 1)) return null
    const rank = value >= 100 ? 2 : value >= 10 ? 1 : 0
    if (rank >= previousRank) return null
    previousRank = value >= 10 && value < 20 ? 0 : rank
    total += value
  }
  return total
}

function normalizeNumber(text: string): string | null {
  if (leadingDigitPattern.test(text))
    return text.replace(thousandsAtEnd, 'к').replace(spacedThousandsSuffixPattern, '$1')
  const words = text.split(' ')
  const marker = words.findIndex((word) => thousandsWord.test(word))
  if (marker < 0) return spokenGroup(words)?.toString() ?? null

  const high =
    marker === 0 && (words[0] === 'тысяча' || words[0] === 'тыща')
      ? 1
      : spokenGroup(words.slice(0, marker))
  const low = spokenGroup(words.slice(marker + 1))
  return high && low !== null ? String(high * 1000 + low) : null
}

export function normalizeSpokenAmount(text: string): string | null {
  const input = text
    .toLowerCase()
    .trim()
    .replace(whitespacePattern, ' ')
    .replace(edgePunctuation, '')
    .replace(operationPrefix, '')
    .trim()
  if (input.length > 500 || unsupportedCurrencyOrPlusPattern.test(input.replaceAll('₽', '')))
    return null

  const [match, extra] = [...input.matchAll(amount)]
  if (!match?.groups || extra) return null
  const before = input.slice(0, match.index).replace(edgePunctuation, '')
  const after = input.slice(match.index + match[0].length).replace(edgePunctuation, '')
  const prefix = before
    .replace(amountConnector, '')
    .trim()
    .replace(descriptionPrepositionPattern, '')
  const suffix = after.replace(descriptionPrepositionPattern, '')
  if (prefix && suffix) return null
  const description = prefix || suffix
  if (
    !letterPattern.test(description) ||
    unsupportedWords.test(description) ||
    detachedMinusPattern.test(before)
  )
    return null

  const rubles = normalizeNumber(match.groups.rubles)
  if (rubles === null) return null
  let amountText = rubles
  if (match.groups.kopecks) {
    const kopecks = normalizeNumber(match.groups.kopecks)
    if (
      !groupedWholeRublesPattern.test(rubles) ||
      kopecks === null ||
      !kopeckDigitsPattern.test(kopecks)
    )
      return null
    amountText += `,${kopecks.padStart(2, '0')}`
  }
  return `${amountText} ${description}`
}
