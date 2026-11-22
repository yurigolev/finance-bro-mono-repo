import { dateInZone } from '../shared/calendar.ts'
import type {
  CategoryChoice,
  DailyHistory,
  OperationDraft,
  OperationInput,
  OperationKind,
  OperationSummary,
  RecordOperationResult,
} from './types.ts'

export type OperationCategoryLookup<Connection> = {
  ruleExpression: (description: string) => string | null
  initializeCategories: (tx: Connection, userId: string) => Promise<boolean>
  findOperationCategory: (
    tx: Connection,
    userId: string,
    kind: OperationKind,
    expression: string,
  ) => Promise<CategoryChoice | undefined>
  findCategoryPhrases: (
    tx: Connection,
    userId: string,
    kind: OperationKind,
    expression: string,
  ) => Promise<CategoryChoice[]>
}

type RecordOperationDependencies<Connection> = OperationCategoryLookup<Connection> & {
  withTransaction: <T>(run: (tx: Connection) => Promise<T>) => Promise<T>
  insertOperation: (
    tx: Connection,
    userId: string,
    input: OperationInput,
    idempotencyKey: string,
    categoryId?: string,
  ) => Promise<string | null>
  hasOperation: (tx: Connection, userId: string, idempotencyKey: string) => Promise<boolean>
}

export function createRecordOperation<Connection>({
  withTransaction,
  insertOperation,
  hasOperation,
  ruleExpression,
  initializeCategories,
  findOperationCategory,
  findCategoryPhrases,
}: RecordOperationDependencies<Connection>) {
  return async function recordOperation(
    userId: string,
    input: OperationDraft,
    idempotencyKey: string,
  ): Promise<RecordOperationResult> {
    const expression = ruleExpression(input.description)
    return withTransaction(async (tx) => {
      let kind = input.kind
      let matches: CategoryChoice[] = []

      if (kind) {
        if (expression && (await initializeCategories(tx, userId))) {
          const exact = await findOperationCategory(tx, userId, kind, expression)
          matches = exact ? [exact] : await findCategoryPhrases(tx, userId, kind, expression)
        }
      } else {
        await initializeCategories(tx, userId)
        const expense = expression
          ? await findOperationCategory(tx, userId, 'expense', expression)
          : undefined
        const income = expression
          ? await findOperationCategory(tx, userId, 'income', expression)
          : undefined
        let expenses = expense ? [expense] : []
        let incomes = income ? [income] : []
        if (expression && !expense && !income) {
          expenses = await findCategoryPhrases(tx, userId, 'expense', expression)
          incomes = await findCategoryPhrases(tx, userId, 'income', expression)
        }
        if (Boolean(expenses.length) === Boolean(incomes.length)) {
          return (await hasOperation(tx, userId, idempotencyKey))
            ? { status: 'duplicate' }
            : { status: 'kind-required' }
        }

        kind = incomes.length ? 'income' : 'expense'
        matches = kind === 'income' ? incomes : expenses
      }

      const category = matches.length === 1 ? matches[0] : undefined
      const id = await insertOperation(tx, userId, { ...input, kind }, idempotencyKey, category?.id)
      if (!id) return { status: 'duplicate' }
      return matches.length > 1
        ? { status: 'created', id, kind, categoryName: null, categoryChoices: matches }
        : { status: 'created', id, kind, categoryName: category?.name ?? null }
    })
  }
}

type DailyHistoryDependencies = {
  getTimeZone: (userId: string) => Promise<string | null>
  dailyHistory: (userId: string, date: string, timeZone: string) => Promise<OperationSummary[]>
}

export function createLoadDailyHistory({ getTimeZone, dailyHistory }: DailyHistoryDependencies) {
  return async function loadDailyHistory(
    userId: string,
    requestedDate?: string | null,
  ): Promise<DailyHistory | null> {
    const timeZone = (await getTimeZone(userId)) ?? 'UTC'
    const today = dateInZone(timeZone)
    if (requestedDate === null || (requestedDate !== undefined && requestedDate > today))
      return null
    const date = requestedDate ?? today
    const operations = await dailyHistory(userId, date, timeZone)
    return { operations, date, today, timeZone }
  }
}
