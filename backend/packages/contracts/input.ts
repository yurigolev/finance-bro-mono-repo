import { maxOperationBatchSize } from './operations.ts'
import { z } from 'zod'

const kindSchema = z.enum(['expense', 'income'])
const categorySchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  kind: kindSchema,
  key: z.string().nullable(),
  order: z.int().nonnegative().optional(),
  exactName: z.string().optional(),
})
const ruleSchema = z.object({
  kind: kindSchema,
  expression: z.string().min(1),
  categoryId: z.uuid().nullable(),
  builtInExpression: z.string().optional(),
})

export const categoryMatchingContextSchema = z.object({
  categories: z.array(categorySchema),
  categoryRules: z.array(ruleSchema),
})

export type CategoryMatchingContext = z.infer<typeof categoryMatchingContextSchema>

const timeZoneSchema = z
  .string()
  .max(100)
  .refine((zone) => {
    if (!zone || zone.startsWith('+') || zone.startsWith('-')) return false
    try {
      new Intl.DateTimeFormat('en', { timeZone: zone })
      return true
    } catch {
      return false
    }
  })

export const inputContextSchema = categoryMatchingContextSchema.extend({
  sentAt: z.iso.datetime({ offset: true }).refine((value) => Number.isFinite(Date.parse(value))),
  timeZone: timeZoneSchema,
  kind: kindSchema.optional(),
})

export const maxInputAudioBytes = 1024 * 1024
export const maxInputAudioSeconds = 20
export const maxInputTextLength = 4096
export const inputTextSchema = z.string().min(1).max(maxInputTextLength)

const operationDateSchema = z.object({ date: z.iso.date(), timeZone: timeZoneSchema })
const amountKopecksSchema = z.string().regex(/^[1-9][0-9]{0,18}$/)
const operationDraftSchema = z.object({
  kind: kindSchema.nullable(),
  amountKopecks: amountKopecksSchema,
  currency: z.literal('RUB'),
  description: z.string(),
  operationDate: operationDateSchema.nullable(),
})
const dateAnswerContextSchema = z.object({
  draft: operationDraftSchema,
  today: z.iso.date(),
  timeZone: timeZoneSchema,
})
export type DateAnswerContext = z.infer<typeof dateAnswerContextSchema>

export const clarificationRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('budget-limit'), text: inputTextSchema }),
  dateAnswerContextSchema.extend({
    kind: z.literal('operation-date'),
    text: inputTextSchema,
  }),
])

export const budgetLimitResultSchema = z.object({ amountKopecks: amountKopecksSchema })
export const operationDateResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('resolved'),
    draft: operationDraftSchema.extend({ operationDate: operationDateSchema }),
  }),
  z.object({ status: z.literal('clarification-required'), dates: z.array(z.iso.date()).min(2) }),
])

const operationRowSchema = z.object({
  draft: operationDraftSchema,
  categoryCandidates: z.array(z.object({ id: z.uuid(), name: z.string(), kind: kindSchema })),
  needsClarification: z.array(z.enum(['kind', 'categoryId', 'operationDate'])),
  dateConfirmation: z
    .object({ dates: z.array(z.iso.date()).min(1), today: z.iso.date(), timeZone: timeZoneSchema })
    .optional(),
})

const parseResultSchema = operationRowSchema.extend({
  transcript: z.string().optional(),
  rows: z.array(operationRowSchema).min(2).max(maxOperationBatchSize).optional(),
})

export type ParsedOperationRow = z.infer<typeof operationRowSchema>

const parseErrorSchema = z.object({
  error: z.enum([
    'unrecognized',
    'invalid_date',
    'empty_transcript',
    'transcription_failed',
    'transcription_timeout',
    'audio_too_large',
    'audio_too_long',
    'unsupported_audio',
    'invalid_request',
    'unauthorized',
    'not_found',
    'method_not_allowed',
    'processor_unavailable',
  ]),
  message: z.string().optional(),
  transcript: z.string().optional(),
})

export { parseErrorSchema, parseResultSchema }
export type InputContext = z.infer<typeof inputContextSchema>
export type ParseResult = z.infer<typeof parseResultSchema>
export type ParseError = z.infer<typeof parseErrorSchema>
export type ParseErrorCode = ParseError['error']
export type InputResponse<Result = ParseResult> =
  { ok: true; result: Result } | ({ ok: false } & ParseError)
export type ClarificationRequest = z.infer<typeof clarificationRequestSchema>
export type ClarificationResult =
  z.infer<typeof budgetLimitResultSchema> | z.infer<typeof operationDateResultSchema>
