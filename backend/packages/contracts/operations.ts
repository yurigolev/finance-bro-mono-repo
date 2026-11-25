import { z } from 'zod'

const kind = z.enum(['expense', 'income'])
const telegramUserId = z.int().positive()
const categoryId = z.uuid().nullable()
const idempotencyKey = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => value.trim() === value && !value.includes('\0'))

export const structuredOperationRequestSchema = z.strictObject({
  telegramUserId,
  idempotencyKey,
  kind,
  currency: z.literal('RUB'),
  amountKopecks: z
    .string()
    .regex(/^[1-9]\d{0,18}$/)
    .transform(BigInt)
    .refine((amount) => amount <= 9_223_372_036_854_775_807n),
  description: z
    .string()
    .max(200)
    .refine((value) => !value.includes('\0')),
  operationDate: z
    .strictObject({
      date: z.iso.date().refine((value) => value >= '0001-01-01'),
      timeZone: z.string().regex(/^[a-z][a-z0-9_+/-]{0,99}$/i),
    })
    .optional(),
  categoryId,
})

export const maxOperationBatchSize = 10
export const structuredOperationBatchRequestSchema = z.strictObject({
  telegramUserId,
  idempotencyKey,
  rows: z
    .array(structuredOperationRequestSchema.omit({ telegramUserId: true, idempotencyKey: true }))
    .min(2)
    .max(maxOperationBatchSize),
})

export const structuredCategoryRequestSchema = z.strictObject({ telegramUserId, categoryId })

export const operationReplayQuerySchema = z.object({
  telegramUserId: z
    .string()
    .regex(/^[1-9]\d{0,15}$/)
    .transform(Number)
    .pipe(telegramUserId),
  idempotencyKey,
})

export const structuredCategoryResultSchema = z.object({ id: z.uuid(), kind, categoryId })

export const structuredOperationResultSchema = structuredCategoryResultSchema.extend({
  categoryName: z.string().nullable(),
  replayed: z.boolean(),
  deleted: z.boolean(),
})

export type StructuredOperationRequest = z.input<typeof structuredOperationRequestSchema>
export type StructuredOperationResult = z.infer<typeof structuredOperationResultSchema>
export type StructuredCategoryResult = z.infer<typeof structuredCategoryResultSchema>

export const structuredOperationBatchResultSchema = z.object({
  rows: z.array(structuredOperationResultSchema).min(2).max(maxOperationBatchSize),
})
export type StructuredOperationBatchRequest = z.input<typeof structuredOperationBatchRequestSchema>
