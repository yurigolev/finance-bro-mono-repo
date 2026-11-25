const regexSpecialCharacterPattern = /[.*+?^${}()|[\]\\]/gu
const wordCharacterPattern = '[\\p{L}\\p{M}\\p{N}_]'

export const russianWordPattern = /(?<![\p{L}\p{M}\p{N}_])[а-я]+(?![\p{L}\p{M}\p{N}_])/gu
export const builtInWordWhitespacePattern = /\s+/gu

export function categoryPhrasePattern(phrase: string): RegExp {
  const literal = phrase.replace(regexSpecialCharacterPattern, '\\$&')
  return new RegExp(`(?<!${wordCharacterPattern})${literal}(?!${wordCharacterPattern})`, 'u')
}
