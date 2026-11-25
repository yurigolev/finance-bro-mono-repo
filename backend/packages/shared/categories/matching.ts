import { russian } from 'multilingual-stemmer'
import type { CategoryMatchingContext } from '../../contracts/input.ts'
import type { OperationKind } from '../../contracts/transactions.ts'
import { categoryPhrasePattern, russianWordPattern } from './patterns.ts'
import {
  builtInGroup,
  normalizeBuiltInWord,
  starterCategories,
  starterCategoryName,
} from './starter-categories.ts'
import type { BuiltInTarget } from '../../contracts/categories.ts'

type CategoryTarget = CategoryMatchingContext['categories'][number]
type MatchingRule = CategoryMatchingContext['categoryRules'][number]
type Candidate = Pick<CategoryTarget, 'id' | 'name' | 'kind'>
type Match = { kind?: OperationKind; categoryCandidates: Candidate[] }

export function ruleExpression(description: string): string | null {
  const expression = description.trim()
  return expression && !expression.includes('\0') && [...expression].length <= 200
    ? expression
    : null
}

function stemRussianWords(text: string) {
  return text.replace(russianWordPattern, (word) => russian(word))
}

function includesCategoryPhrase(description: string, phrase: string) {
  return description.includes(phrase) && categoryPhrasePattern(phrase).test(description)
}

export function findPhraseCategoryIds(
  kind: OperationKind,
  expression: string,
  catalogue: BuiltInTarget[],
  rules: Pick<MatchingRule, 'expression' | 'categoryId'>[],
) {
  const words = new Map<string, string | null>()
  for (const group of starterCategories[kind]) {
    const category = catalogue.find(({ key }) => key === group.key)
    if (!category) continue
    for (const word of group.words) words.set(normalizeBuiltInWord(word), category.id)
    words.set(normalizeBuiltInWord(group.name.slice(group.name.indexOf(' ') + 1)), category.id)
  }
  for (const rule of rules) words.set(normalizeBuiltInWord(rule.expression), rule.categoryId)
  for (const category of catalogue) words.set(normalizeBuiltInWord(category.name), category.id)

  const description = normalizeBuiltInWord(expression)
  const stemmedDescription = stemRussianWords(description)
  const ids = new Set<string>()
  const exactStems = new Set<string>()
  const stemmedMatches: { stem: string; id: string }[] = []
  for (const [phrase, id] of words) {
    const stem = stemRussianWords(phrase)
    if (includesCategoryPhrase(description, phrase)) {
      exactStems.add(stem)
      if (id) ids.add(id)
    } else if (id && includesCategoryPhrase(stemmedDescription, stem)) {
      stemmedMatches.push({ stem, id })
    }
  }
  for (const { stem, id } of stemmedMatches) {
    if (!exactStems.has(stem)) ids.add(id)
  }
  return ids
}

function lowerForExactMatch(value: string) {
  // PostgreSQL's default UTF-8 libc locale lowercases each character independently.
  return Array.from(value, (character) => (character === 'İ' ? 'i' : character.toLowerCase())).join(
    '',
  )
}

const targetExactName = (category: CategoryTarget) =>
  category.exactName ?? lowerForExactMatch(category.name.replace(/^ +| +$/gu, ''))

function findExactCategory(
  kind: OperationKind,
  expression: string,
  categories: CategoryTarget[],
  rules: MatchingRule[],
) {
  const exactName = lowerForExactMatch(expression)
  const category = categories.find((item) => targetExactName(item) === exactName)
  if (category) return category
  const starterName = starterCategoryName(kind, expression)
  if (starterName) {
    const starter = categories.find(
      (item) => targetExactName(item) === lowerForExactMatch(starterName),
    )
    if (starter) return starter
  }

  const starter = builtInGroup(kind, expression)
  const rule = starter
    ? findBuiltInRule(rules, normalizeBuiltInWord(expression))
    : rules.find((item) => item.expression === exactName)
  if (rule) return categories.find((item) => item.id === rule.categoryId)
  return starter && categories.find((item) => item.key === starter.key)
}

function findBuiltInRule(rules: MatchingRule[], normalized: string) {
  // The canonical spelling has priority over other matching stored spellings.
  return (
    rules.find(({ expression }) => expression === normalized) ??
    rules.find(
      (item) => (item.builtInExpression ?? normalizeBuiltInWord(item.expression)) === normalized,
    )
  )
}

function candidate({ id, name, kind }: CategoryTarget): Candidate {
  return { id, name, kind }
}

export function matchOperationCategories(
  context: CategoryMatchingContext,
  draft: { kind?: OperationKind; description: string },
): Match {
  const expression = ruleExpression(draft.description)
  if (!expression) return { kind: draft.kind, categoryCandidates: [] }

  const matching = (kind: OperationKind) => {
    const categories = context.categories.filter((item) => item.kind === kind)
    const rules = context.categoryRules.filter((item) => item.kind === kind)
    const exact = findExactCategory(kind, expression, categories, rules)
    return {
      exact,
      phrases() {
        const ids = findPhraseCategoryIds(kind, expression, categories, rules)
        return categories
          .filter(({ id }) => ids.has(id))
          .sort((first, second) => (first.order ?? 0) - (second.order ?? 0))
      },
    }
  }

  if (draft.kind) {
    const match = matching(draft.kind)
    return {
      kind: draft.kind,
      categoryCandidates: (match.exact ? [match.exact] : match.phrases()).map(candidate),
    }
  }

  const expense = matching('expense')
  const income = matching('income')
  // The current write path only checks phrases if neither kind has an exact match.
  const usePhrases = !expense.exact && !income.exact
  const expenses = expense.exact ? [expense.exact] : usePhrases ? expense.phrases() : []
  const incomes = income.exact ? [income.exact] : usePhrases ? income.phrases() : []
  const kind =
    Boolean(expenses.length) === Boolean(incomes.length)
      ? undefined
      : expenses.length
        ? 'expense'
        : 'income'
  return { kind, categoryCandidates: [...expenses, ...incomes].map(candidate) }
}
