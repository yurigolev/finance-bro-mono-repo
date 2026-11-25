import { and, desc, DrizzleQueryError, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { DatabaseError } from 'pg'
import type { Database } from '../db/client.ts'
import {
  activeCategoryNameIndex,
  categories,
  categoryRules,
  transactions,
  users,
} from '../db/schema.ts'
import { activeOperation } from '../transactions/repository.ts'
import type { OperationKind } from '../../../packages/contracts/transactions.ts'
import type {
  BuiltInTarget,
  CategoryChoice,
  CategoryRule,
} from '../../../packages/contracts/categories.ts'

type ReadConnection = Pick<Database, 'select'>
type CategoryLock = 'update' | 'no key update'
type StarterCategory = { kind: OperationKind; name: string; starterKey: string }
type RuleLookup = { expression: string; normalized: string; builtIn: boolean }

function activeCategory(userId: string, id: string, kind?: OperationKind) {
  return and(
    eq(categories.userId, userId),
    eq(categories.id, id),
    isNull(categories.archivedAt),
    kind && eq(categories.kind, kind),
  )
}

function activeCategories(userId: string, kind: OperationKind) {
  return and(
    eq(categories.userId, userId),
    eq(categories.kind, kind),
    isNull(categories.archivedAt),
  )
}

const categoryFields = { id: categories.id, name: categories.name }

export async function lockCategoryOwner(
  connection: ReadConnection,
  userId: string,
): Promise<boolean> {
  // Serialize initialization without blocking inserts that reference the user.
  const [user] = await connection
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .for('no key update')
  return Boolean(user)
}

export async function hasCategoryCatalogue(
  connection: ReadConnection,
  userId: string,
): Promise<boolean> {
  const [category] = await connection
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.userId, userId))
    .limit(1)
  return Boolean(category)
}

export async function insertStarterCategories(
  connection: Pick<Database, 'insert'>,
  userId: string,
  defaults: StarterCategory[],
): Promise<void> {
  await connection.insert(categories).values(defaults.map((entry) => ({ userId, ...entry })))
}

export async function listActiveCategories(
  connection: ReadConnection,
  userId: string,
  kind: OperationKind,
): Promise<CategoryChoice[]> {
  return connection
    .select(categoryFields)
    .from(categories)
    .where(activeCategories(userId, kind))
    .orderBy(categories.name, categories.id)
}

export async function insertCategory(
  connection: Pick<Database, 'insert'>,
  userId: string,
  kind: OperationKind,
  name: string,
): Promise<boolean> {
  const [inserted] = await connection
    .insert(categories)
    .values({ userId, kind, name })
    .onConflictDoNothing()
    .returning({ id: categories.id })
  return Boolean(inserted)
}

export async function updateCategoryName(
  connection: Pick<Database, 'update'>,
  userId: string,
  id: string,
  name: string,
): Promise<'ok' | 'duplicate' | 'unavailable'> {
  try {
    const [renamed] = await connection
      .update(categories)
      .set({ name })
      .where(activeCategory(userId, id))
      .returning({ id: categories.id })
    return renamed ? 'ok' : 'unavailable'
  } catch (error) {
    if (
      error instanceof DrizzleQueryError &&
      error.cause instanceof DatabaseError &&
      error.cause.code === '23505' &&
      error.cause.constraint === activeCategoryNameIndex
    )
      return 'duplicate'
    throw error
  }
}

export async function archiveCategory(
  connection: Pick<Database, 'update'>,
  userId: string,
  id: string,
): Promise<boolean> {
  const [archived] = await connection
    .update(categories)
    .set({ archivedAt: sql`now()` })
    .where(activeCategory(userId, id))
    .returning({ id: categories.id })
  return Boolean(archived)
}

export async function lockActiveCategoryChoice(
  connection: ReadConnection,
  userId: string,
  id: string,
): Promise<CategoryChoice | undefined> {
  const [category] = await connection
    .select(categoryFields)
    .from(categories)
    .where(activeCategory(userId, id))
    .for('no key update')
  return category
}

export async function lockActiveCategoryAssignment(
  connection: ReadConnection,
  userId: string,
  id: string,
  lock: CategoryLock,
) {
  // Assignment also uses this projection before the starter key migration.
  const [category] = await connection
    .select({ kind: categories.kind, name: categories.name })
    .from(categories)
    .where(activeCategory(userId, id))
    .for(lock)
  return category
}

export async function lockActiveCategoryKind(
  connection: ReadConnection,
  userId: string,
  id: string,
  lock: CategoryLock,
): Promise<OperationKind | undefined> {
  return (await lockActiveCategoryAssignment(connection, userId, id, lock))?.kind
}

export async function lockActiveRuleTarget(
  connection: ReadConnection,
  userId: string,
  id: string,
  kind: OperationKind,
): Promise<boolean> {
  const [category] = await connection
    .select({ id: categories.id })
    .from(categories)
    .where(activeCategory(userId, id, kind))
    .for('no key update')
  return Boolean(category)
}

export async function lockActiveStarterTarget(
  connection: ReadConnection,
  userId: string,
  id: string,
  kind: OperationKind,
): Promise<{ key: string | null } | undefined> {
  const [category] = await connection
    .select({ key: categories.starterKey })
    .from(categories)
    .where(activeCategory(userId, id, kind))
    .for('no key update')
  return category
}

export async function updateOperationCategory(
  connection: Pick<Database, 'update'>,
  userId: string,
  operationId: string,
  categoryId: string | null,
  kind?: OperationKind,
): Promise<boolean> {
  const [updated] = await connection
    .update(transactions)
    .set({ categoryId })
    .where(and(activeOperation(userId, operationId), kind && eq(transactions.kind, kind)))
    .returning({ id: transactions.id })
  return Boolean(updated)
}

export async function lockOperationDescription(
  connection: ReadConnection,
  userId: string,
  operationId: string,
  kind: OperationKind,
  categoryId: string,
): Promise<string | undefined> {
  const [operation] = await connection
    .select({ description: transactions.description })
    .from(transactions)
    .where(
      and(
        activeOperation(userId, operationId),
        eq(transactions.kind, kind),
        eq(transactions.categoryId, categoryId),
      ),
    )
    .for('update')
  return operation?.description
}

function categoryNameEquals(name: string) {
  return sql`lower(btrim(${categories.name})) = lower(${name})`
}

function exactCategory(
  userId: string,
  kind: OperationKind,
  expression: string,
  starterName: string | undefined,
) {
  return and(
    activeCategories(userId, kind),
    or(categoryNameEquals(expression), starterName ? categoryNameEquals(starterName) : undefined),
  )
}

export async function hasExactCategory(
  connection: ReadConnection,
  userId: string,
  kind: OperationKind,
  expression: string,
  starterName: string | undefined,
): Promise<boolean> {
  const [category] = await connection
    .select({ id: categories.id })
    .from(categories)
    .where(exactCategory(userId, kind, expression, starterName))
    .limit(1)
  return Boolean(category)
}

export async function lockExactCategory(
  connection: ReadConnection,
  userId: string,
  kind: OperationKind,
  expression: string,
  starterName: string | undefined,
): Promise<CategoryChoice | undefined> {
  const [category] = await connection
    .select(categoryFields)
    .from(categories)
    .where(exactCategory(userId, kind, expression, starterName))
    .orderBy(desc(categoryNameEquals(expression)))
    .limit(1)
    .for('no key update')
  return category
}

function starterKeyFilter(userId: string, kind: OperationKind, key: string) {
  return and(
    eq(categories.userId, userId),
    eq(categories.kind, kind),
    eq(categories.starterKey, key),
  )
}

export async function lockActiveStarterCategory(
  connection: ReadConnection,
  userId: string,
  kind: OperationKind,
  key: string,
): Promise<CategoryChoice | undefined> {
  const [category] = await connection
    .select(categoryFields)
    .from(categories)
    .where(and(starterKeyFilter(userId, kind, key), isNull(categories.archivedAt)))
    .for('no key update')
  return category
}

export async function lockStarterCategory(
  connection: ReadConnection,
  userId: string,
  kind: OperationKind,
  key: string,
): Promise<{ archivedAt: Date | null } | undefined> {
  const [category] = await connection
    .select({ archivedAt: categories.archivedAt })
    .from(categories)
    .where(starterKeyFilter(userId, kind, key))
    .for('no key update')
  return category
}

export async function clearStarterKey(
  connection: Pick<Database, 'update'>,
  userId: string,
  kind: OperationKind,
  key: string,
): Promise<void> {
  await connection
    .update(categories)
    .set({ starterKey: null })
    .where(starterKeyFilter(userId, kind, key))
}

export async function assignStarterKey(
  connection: Pick<Database, 'update'>,
  categoryId: string,
  key: string,
): Promise<void> {
  await connection.update(categories).set({ starterKey: key }).where(eq(categories.id, categoryId))
}

export async function listActiveTargets(
  connection: ReadConnection,
  userId: string,
  kind: OperationKind,
): Promise<BuiltInTarget[]> {
  return connection
    .select({ ...categoryFields, key: categories.starterKey })
    .from(categories)
    .where(activeCategories(userId, kind))
}

export function listMatchingCategoryNames(connection: ReadConnection, userId: string) {
  return connection
    .select({ id: categories.id, exactName: sql<string>`lower(btrim(${categories.name}))` })
    .from(categories)
    .where(and(eq(categories.userId, userId), isNull(categories.archivedAt)))
    .orderBy(categories.name, categories.id)
}

export async function lockCategoryChoices(
  connection: ReadConnection,
  userId: string,
  kind: OperationKind,
  ids: string[],
): Promise<CategoryChoice[]> {
  return connection
    .select(categoryFields)
    .from(categories)
    .where(and(activeCategories(userId, kind), inArray(categories.id, ids)))
    .orderBy(categories.name, categories.id)
    .for('no key update')
}

const normalizedRuleExpression = sql<string>`replace(regexp_replace(${categoryRules.expression}, '[[:space:]]+', ' ', 'g'), 'ё', 'е')`

function normalizedRuleEquals(normalized: string) {
  return sql`${normalizedRuleExpression} = ${normalized}`
}

function selectRules(connection: ReadConnection) {
  return connection
    .select({
      id: categoryRules.id,
      categoryId: categoryRules.categoryId,
      expression: categoryRules.expression,
      kind: categoryRules.kind,
      categoryName: categories.name,
      archivedAt: categories.archivedAt,
    })
    .from(categoryRules)
    .leftJoin(categories, eq(categoryRules.categoryId, categories.id))
}

export async function findCategoryRule(
  connection: ReadConnection,
  userId: string,
  kind: OperationKind,
  { expression, normalized, builtIn }: RuleLookup,
): Promise<CategoryRule | undefined> {
  const [rule] = await selectRules(connection)
    .where(
      and(
        eq(categoryRules.userId, userId),
        eq(categoryRules.kind, kind),
        builtIn
          ? normalizedRuleEquals(normalized)
          : sql`${categoryRules.expression} = lower(${expression})`,
      ),
    )
    .orderBy(desc(eq(categoryRules.expression, normalized)), categoryRules.expression)
    .limit(1)
  return rule
}

export async function listCategoryRules(
  connection: ReadConnection,
  userId: string,
  kind?: OperationKind,
): Promise<CategoryRule[]> {
  return selectRules(connection)
    .where(and(eq(categoryRules.userId, userId), kind && eq(categoryRules.kind, kind)))
    .orderBy(categoryRules.kind, categoryRules.expression)
}

export function listMatchingCategoryRules(connection: ReadConnection, userId: string) {
  return connection
    .select({
      kind: categoryRules.kind,
      expression: categoryRules.expression,
      categoryId: categoryRules.categoryId,
      builtInExpression: normalizedRuleExpression,
    })
    .from(categoryRules)
    .where(eq(categoryRules.userId, userId))
    .orderBy(categoryRules.kind, categoryRules.expression)
}

export async function saveRule(
  connection: Pick<Database, 'insert'>,
  userId: string,
  kind: OperationKind,
  expression: string,
  categoryId: string | null,
): Promise<void> {
  await connection
    .insert(categoryRules)
    .values({ userId, kind, expression: sql`lower(${expression})`, categoryId })
    .onConflictDoUpdate({
      target: [categoryRules.userId, categoryRules.kind, categoryRules.expression],
      set: { categoryId },
    })
}

export async function deleteBuiltInOverrides(
  connection: Pick<Database, 'delete'>,
  userId: string,
  kind: OperationKind,
  normalized: string,
  keepNormalizedRule: boolean,
): Promise<void> {
  await connection
    .delete(categoryRules)
    .where(
      and(
        eq(categoryRules.userId, userId),
        eq(categoryRules.kind, kind),
        normalizedRuleEquals(normalized),
        keepNormalizedRule ? sql`${categoryRules.expression} <> ${normalized}` : undefined,
      ),
    )
}

export async function deleteCategoryRule(
  connection: Pick<Database, 'delete'>,
  userId: string,
  id: string,
  categoryId: string | null,
): Promise<boolean> {
  const [deleted] = await connection
    .delete(categoryRules)
    .where(
      and(
        eq(categoryRules.userId, userId),
        eq(categoryRules.id, id),
        categoryId === null
          ? isNull(categoryRules.categoryId)
          : eq(categoryRules.categoryId, categoryId),
      ),
    )
    .returning({ id: categoryRules.id })
  return Boolean(deleted)
}
