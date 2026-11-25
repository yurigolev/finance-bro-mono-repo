export const numberWords = new Map<string, number>(
  Object.entries({
    ноль: 0,
    один: 1,
    одна: 1,
    одно: 1,
    два: 2,
    две: 2,
    три: 3,
    четыре: 4,
    пять: 5,
    шесть: 6,
    семь: 7,
    восемь: 8,
    девять: 9,
    десять: 10,
    одиннадцать: 11,
    двенадцать: 12,
    тринадцать: 13,
    четырнадцать: 14,
    пятнадцать: 15,
    шестнадцать: 16,
    семнадцать: 17,
    восемнадцать: 18,
    девятнадцать: 19,
    двадцать: 20,
    тридцать: 30,
    сорок: 40,
    пятьдесят: 50,
    шестьдесят: 60,
    семьдесят: 70,
    восемьдесят: 80,
    девяносто: 90,
    сто: 100,
    двести: 200,
    триста: 300,
    четыреста: 400,
    пятьсот: 500,
    шестьсот: 600,
    семьсот: 700,
    восемьсот: 800,
    девятьсот: 900,
  }),
)
const thousands = '(?:тысяч|тыщ)(?:а|и)?'
export const thousandsAtEnd = new RegExp(thousands + '$', 'u')
export const thousandsWord = new RegExp('^' + thousands + '$', 'u')
const word = `(?:${[...numberWords.keys()].join('|')}|${thousands})`
const digits = String.raw`(?:\d{1,3}(?: \d{3})+|\d+)(?:[.,]\d{1,2})?`
const number = String.raw`(?:${digits}(?: *[кk]| +(?:тыс\.?|${thousands}))?|${word}(?: +${word})*)`
const ruble = String.raw`(?:₽|руб(?:лей|ля|ль|\.)?|р\.?)`
const kopeck = String.raw`коп(?:еек|ейки|ейка|\.)?`
export const amount = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?<rubles>${number})(?: *(?<unit>${ruble})(?: +(?<kopecks>${number}) +${kopeck})?)?(?![\p{L}\p{N}])`,
  'gu',
)
export const edgePunctuation = /^[\s.,!?;:…«»]+|[\s.,!?;:…«»]+$/gu
const operationVerb = 'потратил[аи]?|заплатил[аи]?|отдал[аи]?|купил[аи]?|получил[аи]?'
export const operationPrefix = new RegExp(`^(?:я +)?(?:${operationVerb}|расход|доход) +`, 'u')
export const amountConnector = new RegExp(
  `(?:^| +)(?:(?:${operationVerb}|обош[её]л(?:ся|ась|ись)|стоил[аои]?)(?: +(?:в|на|за))?|(?:в|на|за))$`,
  'u',
)
export const unsupportedWords =
  /(?:^|[^\p{L}])(?:сегодня|вчера|позавчера|завтра|прошл\p{L}*|доллар\p{L}*|евро|юан\p{L}*|тенге|фунт\p{L}*|бакс\p{L}*|млн|миллион\p{L}*|млрд|миллиард\p{L}*|коп(?:еек|ейка|ейки)?|usd|eur|cny)(?!\p{L})/iu
export const leadingDigitPattern = /^\d/u
export const spacedThousandsSuffixPattern = / +([кk])$/u
export const whitespacePattern = /\s+/gu
export const unsupportedCurrencyOrPlusPattern = /[+\p{Sc}]/u
export const descriptionPrepositionPattern = /^(?:на|за) +/u
export const letterPattern = /\p{L}/u
export const detachedMinusPattern = /(?:^| )[-−]$/u
export const groupedWholeRublesPattern = /^\d+(?: \d{3})*$/u
export const kopeckDigitsPattern = /^\d{1,2}$/u
