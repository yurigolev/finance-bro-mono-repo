import { z } from 'zod'

const id = z.guid()
const kind = z.enum(['income', 'expense'])
const day = z.iso.date()
const timeZone = z.string()
const amount = z.codec(z.string().regex(/^-?\d+$/), z.bigint(), {
  decode: (value) => BigInt(value),
  encode: (value) => value.toString(),
})
const instant = z.codec(z.iso.datetime(), z.date(), {
  decode: (value) => new Date(value),
  encode: (value) => value.toISOString(),
})

const categoryChoice = z.strictObject({ id, name: z.string() })
const categoryRule = z.strictObject({
  id,
  categoryId: id.nullable(),
  expression: z.string(),
  kind,
  categoryName: z.string().nullable(),
  archivedAt: instant.nullable(),
})
const categoryWriteResult = z.enum(['ok', 'duplicate', 'invalid', 'unavailable'])
const operationDate = z.strictObject({ date: day, timeZone })
const operationSummary = z.strictObject({
  id,
  kind,
  amountKopecks: amount,
  description: z.string(),
  createdAt: instant,
  categoryName: z.string().nullable(),
})
const monthlyBudget = z.strictObject({
  totalSpent: amount,
  totalLimit: amount.nullable(),
  categories: z.array(
    z.strictObject({
      id,
      name: z.string(),
      archived: z.boolean(),
      limit: amount,
      spent: amount,
    }),
  ),
})
const budgetLimitChange = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('set'), amountKopecks: amount.nullable() }),
  z.strictObject({ kind: z.literal('disable') }),
])

function endpoint<Args extends unknown[], Result>(
  args: z.ZodType<Args>,
  result: z.ZodType<Result>,
) {
  return { args, result }
}

export const telegramEndpointPrefix = '/internal/v1/telegram'

export const telegramContract = {
  users: {
    getOrCreateUser: endpoint(z.tuple([z.int().positive()]), id),
    getTimeZone: endpoint(z.tuple([id]), timeZone.nullable()),
    setTimeZone: endpoint(
      z.tuple([id, timeZone.nullable()]),
      z.union([
        z.strictObject({ timeZone: timeZone.nullable() }),
        z.enum(['invalid', 'unavailable']),
      ]),
    ),
  },
  categories: {
    listCategories: endpoint(z.tuple([id, kind]), z.array(categoryChoice)),
    addCategory: endpoint(z.tuple([id, kind, z.string()]), categoryWriteResult),
    renameCategory: endpoint(z.tuple([id, id, z.string()]), categoryWriteResult),
    archiveCategory: endpoint(z.tuple([id, id]), z.boolean()),
    setCategory: endpoint(z.tuple([id, id, id.nullable()]), z.boolean()),
    canRememberCategory: endpoint(z.tuple([id, kind, z.string()]), z.boolean()),
    rememberCategory: endpoint(z.tuple([id, id, id]), z.boolean()),
    listCategoryRules: endpoint(z.tuple([id]), z.array(categoryRule)),
    deleteCategoryRule: endpoint(z.tuple([id, id, id.nullable()]), z.boolean()),
    listBuiltInTargets: endpoint(
      z.tuple([id, kind]),
      z.array(categoryChoice.extend({ key: z.string().nullable() })),
    ),
    getBuiltInRule: endpoint(z.tuple([id, kind, z.string()]), categoryRule.nullable()),
    changeBuiltInRule: endpoint(
      z.tuple([id, kind, z.string(), z.union([id.nullable(), z.literal('reset')])]),
      z.boolean(),
    ),
    bindBuiltInGroup: endpoint(z.tuple([id, kind, z.string(), id]), z.boolean()),
  },
  transactions: {
    recent: endpoint(z.tuple([id]), z.array(operationSummary)),
    dailyHistory: endpoint(z.tuple([id, day, timeZone]), z.array(operationSummary)),
    loadDailyHistory: endpoint(
      z.tuple([id, day.nullable().optional()]),
      z
        .strictObject({
          date: day,
          today: day,
          timeZone,
          operations: z.array(operationSummary),
        })
        .nullable(),
    ),
    getOperation: endpoint(
      z.tuple([id, id]),
      operationSummary.extend({ idempotencyKey: z.string(), operationDate }).nullable(),
    ),
    setOperationDate: endpoint(z.tuple([id, id, operationDate]), z.boolean()),
    getOperationKind: endpoint(z.tuple([id, id]), kind.nullable()),
    remove: endpoint(z.tuple([id, id]), z.boolean()),
  },
  budgets: {
    monthlyBudget: endpoint(z.tuple([id, day, timeZone]), monthlyBudget),
    changeBudgetLimit: endpoint(
      z.tuple([id, day, id.nullable(), budgetLimitChange, instant.optional()]),
      z.enum(['saved', 'stale', 'invalid', 'unavailable']),
    ),
    viewBudget: endpoint(
      z.tuple([id, day.optional()]),
      z.strictObject({ budget: monthlyBudget, selected: day, current: day }).nullable(),
    ),
    listBudgetCategoryChoices: endpoint(z.tuple([id, day]), z.array(categoryChoice).nullable()),
    viewBudgetLimit: endpoint(
      z.tuple([id, day, id.nullable()]),
      z.strictObject({ categoryName: z.string().nullable(), limit: amount.nullable() }).nullable(),
    ),
  },
}

export type Endpoint = ReturnType<typeof endpoint>
export type EndpointArgs<Route extends Endpoint> = z.output<Route['args']>
export type EndpointResult<Route extends Endpoint> = z.output<Route['result']>
export type EndpointGroup = Record<string, Endpoint>
export type EndpointService<Group extends EndpointGroup> = {
  [Method in keyof Group]: (
    ...args: EndpointArgs<Group[Method]>
  ) => Promise<EndpointResult<Group[Method]>>
}
