import { russian } from 'multilingual-stemmer'
import type { Database } from '../db/client.ts'
import type { OperationKind } from '../transactions/types.ts'
import * as repository from './repository.ts'
import {
  builtInGroup,
  normalizeBuiltInWord,
  starterCategories,
  starterCategoryName,
} from './starter-categories.ts'
import type { CategoryChoice, CategoryService } from './types.ts'
import { categoryPhrasePattern, russianWordPattern } from './patterns.ts'

const categoryDefaults = (['expense', 'income'] as const).flatMap((kind) =>
  starterCategories[kind].map(({ key, name }) => ({ kind, name, starterKey: key })),
)

function trimCategoryName(input: string): string | null {
  const name = input.trim()
  return name && !name.includes('\0') && [...name].length <= 60 ? name : null
}

function ruleExpression(description: string): string | null {
  const expression = description.trim()
  return expression && !expression.includes('\0') && [...expression].length <= 200
    ? expression
    : null
}

async function initializeCategories(
  tx: Pick<Database, 'select' | 'insert'>,
  userId: string,
): Promise<boolean> {
  if (!(await repository.lockCategoryOwner(tx, userId))) return false
  if (!(await repository.hasCategoryCatalogue(tx, userId))) {
    await repository.insertStarterCategories(tx, userId, categoryDefaults)
  }
  return true
}

async function findOperationCategory(
  tx: Pick<Database, 'select'>,
  userId: string,
  kind: OperationKind,
  expression: string,
): Promise<CategoryChoice | undefined> {
  const exact = await repository.lockExactCategory(
    tx,
    userId,
    kind,
    expression,
    starterCategoryName(kind, expression),
  )
  if (exact) return exact

  const starter = builtInGroup(kind, expression)
  const rule = await repository.findCategoryRule(tx, userId, kind, {
    expression,
    normalized: normalizeBuiltInWord(expression),
    builtIn: Boolean(starter),
  })
  if (rule) {
    if (rule.categoryId === null) return undefined
    return repository.lockActiveCategoryChoice(tx, userId, rule.categoryId)
  }
  return starter && repository.lockActiveStarterCategory(tx, userId, kind, starter.key)
}

function stemRussianWords(text: string) {
  return text.replace(russianWordPattern, (word) => russian(word))
}

function includesCategoryPhrase(description: string, phrase: string) {
  if (!description.includes(phrase)) return false
  return categoryPhrasePattern(phrase).test(description)
}

async function findCategoryPhrases(
  tx: Pick<Database, 'select'>,
  userId: string,
  kind: OperationKind,
  expression: string,
): Promise<CategoryChoice[]> {
  const catalogue = await repository.listActiveTargets(tx, userId, kind)
  const rules = await repository.listCategoryRules(tx, userId, kind)

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
  if (!ids.size) return []
  return repository.lockCategoryChoices(tx, userId, kind, [...ids])
}

export const categoryMatching = {
  ruleExpression,
  initializeCategories,
  findOperationCategory,
  findCategoryPhrases,
}

export function createCategoryService(db: Database): CategoryService {
  return {
    async listCategories(userId, kind) {
      return db.transaction(async (tx) => {
        if (!(await initializeCategories(tx, userId))) return []
        return repository.listActiveCategories(tx, userId, kind)
      })
    },

    async addCategory(userId, kind, input) {
      const name = trimCategoryName(input)
      if (!name) return 'invalid'

      return db.transaction(async (tx) => {
        if (!(await initializeCategories(tx, userId))) return 'unavailable'
        return (await repository.insertCategory(tx, userId, kind, name)) ? 'ok' : 'duplicate'
      })
    },

    async renameCategory(userId, id, input) {
      const name = trimCategoryName(input)
      if (!name) return 'invalid'
      return repository.updateCategoryName(db, userId, id, name)
    },

    archiveCategory: (userId, id) => repository.archiveCategory(db, userId, id),

    async setCategory(userId, operationId, categoryId) {
      return db.transaction(async (tx) => {
        if (categoryId === null)
          return repository.updateOperationCategory(tx, userId, operationId, null)

        // The archive write uses the same category row.
        const kind = await repository.lockActiveCategoryKind(tx, userId, categoryId, 'update')
        if (!kind) return false
        return repository.updateOperationCategory(tx, userId, operationId, categoryId, kind)
      })
    },

    async canRememberCategory(userId, kind, description) {
      const expression = ruleExpression(description)
      if (!expression) return false
      return !(await repository.hasExactCategory(
        db,
        userId,
        kind,
        expression,
        starterCategoryName(kind, expression),
      ))
    },

    async rememberCategory(userId, operationId, categoryId) {
      return db.transaction(async (tx) => {
        if (!(await initializeCategories(tx, userId))) return false
        const kind = await repository.lockActiveCategoryKind(
          tx,
          userId,
          categoryId,
          'no key update',
        )
        if (!kind) return false

        const description = await repository.lockOperationDescription(
          tx,
          userId,
          operationId,
          kind,
          categoryId,
        )
        const expression = description === undefined ? null : ruleExpression(description)
        if (
          !expression ||
          (await repository.hasExactCategory(
            tx,
            userId,
            kind,
            expression,
            starterCategoryName(kind, expression),
          ))
        )
          return false

        if (builtInGroup(kind, expression)) {
          const normalized = normalizeBuiltInWord(expression)
          await repository.deleteBuiltInOverrides(tx, userId, kind, normalized, true)
          await repository.saveRule(tx, userId, kind, normalized, categoryId)
        } else {
          await repository.saveRule(tx, userId, kind, expression, categoryId)
        }
        return true
      })
    },

    listCategoryRules: (userId) => repository.listCategoryRules(db, userId),

    async deleteCategoryRule(userId, id, categoryId) {
      return db.transaction(async (tx) => {
        if (!(await initializeCategories(tx, userId))) return false
        return repository.deleteCategoryRule(tx, userId, id, categoryId)
      })
    },

    async listBuiltInTargets(userId, kind) {
      return db.transaction(async (tx) => {
        if (!(await initializeCategories(tx, userId))) return []
        return repository.listActiveTargets(tx, userId, kind)
      })
    },

    async getBuiltInRule(userId, kind, word) {
      if (!builtInGroup(kind, word)) return null
      const rule = await repository.findCategoryRule(db, userId, kind, {
        expression: word,
        normalized: normalizeBuiltInWord(word),
        builtIn: true,
      })
      return rule ?? null
    },

    async changeBuiltInRule(userId, kind, word, target) {
      if (!builtInGroup(kind, word)) return false
      const normalized = normalizeBuiltInWord(word)
      return db.transaction(async (tx) => {
        if (!(await initializeCategories(tx, userId))) return false
        if (target !== null && target !== 'reset') {
          if (!(await repository.lockActiveRuleTarget(tx, userId, target, kind))) return false
        }
        await repository.deleteBuiltInOverrides(tx, userId, kind, normalized, false)
        if (target !== 'reset') await repository.saveRule(tx, userId, kind, normalized, target)
        return true
      })
    },

    async bindBuiltInGroup(userId, kind, key, categoryId) {
      if (!starterCategories[kind].some((group) => group.key === key)) return false
      return db.transaction(async (tx) => {
        if (!(await initializeCategories(tx, userId))) return false
        const target = await repository.lockActiveStarterTarget(tx, userId, categoryId, kind)
        if (!target || target.key !== null) return false
        const existing = await repository.lockStarterCategory(tx, userId, kind, key)
        if (existing?.archivedAt === null) return false
        if (existing) await repository.clearStarterKey(tx, userId, kind, key)
        await repository.assignStarterKey(tx, categoryId, key)
        return true
      })
    },
  }
}
