import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { lockActiveCategoryKind } from '../categories/repository.ts'
import type { Database } from '../db/client.ts'
import { adjacentMonth, dateInZone } from '../../../packages/shared/calendar.ts'
import type { TelegramDependencies } from '../../../packages/contracts/telegram-dependencies.ts'
import {
  hasOperation,
  insertOperation,
  operationDateExists,
  readMonthlyHistory,
} from './repository.ts'

const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
  .refine((month) => month >= '0001-01')
const createSchema = z.object({
  kind: z.enum(['expense', 'income']),
  amountKopecks: z
    .string()
    .regex(/^[1-9]\d{0,18}$/)
    .transform(BigInt)
    .refine((amount) => amount <= 9_223_372_036_854_775_807n),
  description: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((value) => !value.includes('\0')),
  date: z.iso.date().refine((value) => value >= '0001-01-01'),
  categoryId: z.uuid().nullable(),
  requestId: z.uuid(),
})

async function readOperation(request: IncomingMessage) {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length
    if (size > 4096) {
      request.resume()
      return { error: 'body_too_large', status: 413 } as const
    }
    chunks.push(chunk)
  }
  try {
    const operation = createSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    if (operation.success) return { data: operation.data }
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
  }
  return { error: 'invalid_operation', status: 400 } as const
}

export function createTransactionsHandler(db: Database, users: TelegramDependencies['users']) {
  return async function handleTransactions(
    request: IncomingMessage,
    response: ServerResponse,
    telegramId: number,
    sendJson: (response: ServerResponse, status: number, body: object) => void,
    url: URL,
    instant: Date,
  ) {
    try {
      if (request.method === 'GET') {
        const months = url.searchParams.getAll('month')
        const selected = months[0]
        if (
          months.length > 1 ||
          (selected !== undefined && !monthSchema.safeParse(selected).success)
        ) {
          sendJson(response, 400, { error: 'invalid_month' })
          return
        }
        const userId = await users.getOrCreateUser(telegramId)
        const timeZone = (await users.getTimeZone(userId)) ?? 'UTC'
        const today = dateInZone(timeZone, instant)
        const month = selected ?? today.slice(0, 7)
        if (month > today.slice(0, 7)) {
          sendJson(response, 400, { error: 'invalid_month' })
          return
        }
        const operations = await readMonthlyHistory(
          db,
          userId,
          `${month}-01`,
          `${adjacentMonth(month, 1)}-01`,
          timeZone,
        )
        sendJson(response, 200, {
          month,
          today,
          timeZone,
          operations: operations.map((operation) => ({
            ...operation,
            amountKopecks: operation.amountKopecks.toString(),
          })),
        })
        return
      }

      const input = await readOperation(request)
      if (input.error) {
        sendJson(response, input.status, { error: input.error })
        return
      }

      const userId = await users.getOrCreateUser(telegramId)
      const timeZone = (await users.getTimeZone(userId)) ?? 'UTC'
      const today = dateInZone(timeZone, instant)
      const { date, categoryId, requestId, ...operation } = input.data
      const key = `mini-app:${requestId}`
      const operationDate = date === today ? undefined : { date, timeZone }

      const result = await db.transaction(async (tx) => {
        if (await hasOperation(tx, userId, key)) return 'saved'
        if (date > today || (operationDate && !(await operationDateExists(tx, operationDate)))) {
          return 'invalid_date'
        }
        if (
          categoryId &&
          (await lockActiveCategoryKind(tx, userId, categoryId, 'no key update')) !== operation.kind
        ) {
          return (await hasOperation(tx, userId, key)) ? 'saved' : 'category_unavailable'
        }
        await insertOperation(
          tx,
          userId,
          { ...operation, operationDate },
          key,
          categoryId ?? undefined,
        )
        return 'saved'
      })

      if (result === 'saved') {
        response.writeHead(204, { 'Cache-Control': 'no-store' }).end()
        return
      }
      sendJson(response, result === 'invalid_date' ? 400 : 409, { error: result })
    } catch {
      console.error('Не удалось обработать операции Mini App.')
      sendJson(response, 500, { error: 'transactions_unavailable' })
    }
  }
}
