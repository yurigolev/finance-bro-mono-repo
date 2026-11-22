import assert from 'node:assert/strict'
import test from 'node:test'
import {
  builtInGroup,
  normalizeBuiltInWord,
  starterCategories,
} from '../src/categories/starter-categories.ts'
import { parseOperation } from '../src/telegram/parsing/parser.ts'

test('parses spoken amounts without assigning an operation kind', () => {
  const examples = [
    ['Двести пятьдесят рублей за кофе.', 25_000n, 'кофе'],
    ['Я потратила 250 ₽ на кофе.', 25_000n, 'кофе'],
    ['На кофе потратил 250 рублей.', 25_000n, 'кофе'],
    ['Такси стоило 450 рублей 5 копеек.', 45_005n, 'такси'],
    ['Купила две тысячи триста пятьдесят рублей на продукты', 235_000n, 'продукты'],
    ['Кофе 250,50', 25_050n, 'Кофе'],
    ['Получил три тысячи рублей за проект.', 300_000n, 'проект'],
    ['Двадцать тысяч рублей зарплата.', 2_000_000n, 'зарплата'],
  ] as const
  for (const [text, amountKopecks, description] of examples) {
    assert.deepEqual(parseOperation(text), { amountKopecks, description }, text)
  }
})

test('rejects unsupported or ambiguous spoken amounts', () => {
  for (const text of [
    'кофе за двести и такси за пятьсот',
    'кофе сто или двести',
    'кофе от 200 до 250 рублей',
    'кофе 25 долларов',
    'кофе вчера двести',
    'получил 15000 рублей.',
    'двенадцать пять кофе',
    'двести пятьдесят рублей',
    'кофе около 250–300 рублей',
  ])
    assert.equal(parseOperation(text), null, text)
})

test('reads the same amount and description with or without a sign', () => {
  for (const sign of ['', '+', '-', '−']) {
    assert.deepEqual(parseOperation(`${sign}20000 зарплата`), {
      amountKopecks: 2_000_000n,
      description: 'зарплата',
    })
  }
})

test('preserves exact kopecks and trims surrounding whitespace', () => {
  assert.deepEqual(parseOperation('  -480,5   кофе с молоком  '), {
    amountKopecks: 48_050n,
    description: 'кофе с молоком',
  })
  assert.deepEqual(parseOperation('+0.01 возврат'), {
    amountKopecks: 1n,
    description: 'возврат',
  })
  assert.equal(
    parseOperation('92233720368547758.07 верхняя граница')?.amountKopecks,
    9_223_372_036_854_775_807n,
  )
})

test('accepts the amount after the description with the same signs and decimal separators', () => {
  assert.deepEqual(parseOperation('квартира 200'), parseOperation('200 квартира'))
  assert.deepEqual(
    parseOperation('  за квартиру\u202f−200,50  '),
    parseOperation('−200,50 за квартиру'),
  )
  assert.deepEqual(parseOperation('зарплата +0.01'), parseOperation('+0.01 зарплата'))
  assert.equal(
    parseOperation('кофе 92233720368547758.07')?.amountKopecks,
    9_223_372_036_854_775_807n,
  )
  assert.equal(parseOperation('200 айфон 15')?.description, 'айфон 15')
})

test('reads amounts with grouped thousands in either position', () => {
  for (const text of ['40 000 квартира', 'квартира 40 000']) {
    assert.deepEqual(parseOperation(text), {
      amountKopecks: 4_000_000n,
      description: 'квартира',
    })
  }
  assert.deepEqual(parseOperation('зарплата +1\u00a0234\u202f567,89'), {
    amountKopecks: 123_456_789n,
    description: 'зарплата',
  })
  assert.deepEqual(parseOperation('−15\u202f000.5 за квартиру'), {
    amountKopecks: 1_500_050n,
    description: 'за квартиру',
  })
  assert.equal(
    parseOperation('92 233 720 368 547 758,07 предел')?.amountKopecks,
    9_223_372_036_854_775_807n,
  )
})

test('expands abbreviated thousands in either position', () => {
  const operation = { amountKopecks: 4_000_000n, description: 'квартира' }
  for (const text of [
    '40к квартира',
    '40К квартира',
    'квартира 40k',
    'квартира 40 тыс',
    '40 ТЫС. квартира',
  ]) {
    assert.deepEqual(parseOperation(text), operation, text)
  }
  assert.deepEqual(parseOperation('проект +1,5К'), {
    amountKopecks: 150_000n,
    description: 'проект',
  })
  assert.deepEqual(parseOperation('−1.25\u00a0тыс. к врачу'), {
    amountKopecks: 125_000n,
    description: 'к врачу',
  })
  assert.equal(parseOperation('40 к врачу')?.description, 'к врачу')
  assert.equal(parseOperation('40 к врачу')?.amountKopecks, 4_000n)
})

test('asks for clarification on ambiguous or invalid amounts and missing descriptions', () => {
  const invalid = [
    '',
    '480',
    '+ 480 кофе',
    '480,001 кофе',
    '0 кофе',
    'кофе 0',
    'кофе 480,001',
    'кофе + 480',
    'квартира 40 50',
    'квартира 40 50 000',
    'квартира 40 000,005',
    'кофе +480 чай 350',
    'кофе\nчай 350',
    '1 200',
    'кофе 92233720368547758.08',
    '15 00 проект',
    '15\u202f00 проект',
    '480 кофе +15 000 чай',
    '480 кофе\n350 чай',
    'предел 92 233 720 368 547 758,08',
    '40к',
    '40 тыс.',
    'квартира 0к',
    'квартира 1,005к',
    'кофе +1к чай 350',
    '92233720368548k переполнение',
    '92233720368547758.08 переполнение',
    `480 ${'x'.repeat(201)}`,
  ]
  for (const text of invalid) assert.equal(parseOperation(text), null, text)
})

test('every built-in phrase can be entered and maps to one category within its operation kind', () => {
  for (const kind of ['expense', 'income'] as const) {
    const seen = new Set<string>()
    const amount = '100'
    for (const group of starterCategories[kind]) {
      for (const word of group.words) {
        const normalized = normalizeBuiltInWord(word)
        assert.ok(!seen.has(normalized), `${kind}: duplicate phrase «${word}»`)
        seen.add(normalized)
        const operation = parseOperation(`${amount} ${word}`)
        assert.ok(operation, `${kind}: cannot enter «${word}»`)
        assert.equal(builtInGroup(kind, operation.description)?.key, group.key, word)
        assert.deepEqual(parseOperation(`${word} ${amount}`), operation, word)
      }
    }
  }
})
