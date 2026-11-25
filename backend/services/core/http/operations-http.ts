import type { IncomingMessage, ServerResponse } from 'node:http'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  lockActiveCategoryAssignment,
  lockActiveCategoryKind,
  updateOperationCategory,
} from '../categories/repository.ts'
import type { Database } from '../db/client.ts'
import { dateInZone } from '../../../packages/shared/calendar.ts'
import {
  insertOperation,
  operationDateExists,
  readActiveOperationKind,
  readOperationByKey,
} from '../transactions/repository.ts'
import type { OperationDate } from '../../../packages/contracts/transactions.ts'
import { findUserIdByTelegramId, timeZoneExists } from '../users/repository.ts'
import type { createUserService } from '../users/service.ts'
import { HttpRequestError, readJson, sendJson } from './http.ts'
import {
  operationReplayQuerySchema,
  structuredCategoryRequestSchema,
  structuredOperationRequestSchema,
  structuredOperationBatchRequestSchema,
  type StructuredCategoryResult,
  type StructuredOperationResult,
} from '../../../packages/contracts/operations.ts'

const operationsPath = '/internal/v1/operations'
const batchPath = `${operationsPath}/batch`
const replayPath = `${operationsPath}/replay`
const operationPath = /^\/internal\/v1\/operations\/([^/]+)$/
const bodyLimit = 4096

type Users = Pick<ReturnType<typeof createUserService>, 'getOrCreateUser'>
type OperationRequest = z.output<typeof structuredOperationRequestSchema>
type CategoryRequest = z.output<typeof structuredCategoryRequestSchema>
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

type BatchWriteErrorCode = 'date_invalid' | 'category_unavailable' | 'idempotency_conflict'

class BatchWriteError extends Error {
  readonly code: BatchWriteErrorCode
  readonly row: number

  constructor(code: BatchWriteErrorCode, row: number) {
    super(code)
    this.code = code
    this.row = row
  }
}

async function replayOperation(
  tx: Pick<Database, 'select'>,
  userId: string,
  idempotencyKey: string,
): Promise<StructuredOperationResult | null> {
  const existing = await readOperationByKey(tx, userId, idempotencyKey)
  if (!existing) return null
  const { deletedAt, ...result } = existing
  return { ...result, replayed: true, deleted: deletedAt !== null }
}

async function isValidOperationDate(tx: Transaction, date: OperationDate, now: Date) {
  try {
    if (date.date > dateInZone(date.timeZone, now)) return false
  } catch (error) {
    if (error instanceof RangeError) return false
    throw error
  }
  return (await timeZoneExists(tx, date.timeZone)) && operationDateExists(tx, date)
}

export function createStructuredOperationsHandler(
  db: Database,
  users: Users,
  now = () => new Date(),
) {
  async function writeOperation(
    tx: Transaction,
    userId: string,
    input: OperationRequest,
    submittedAt: Date,
  ): Promise<StructuredOperationResult | 'date_invalid' | 'category_unavailable'> {
    const { idempotencyKey, categoryId, kind, amountKopecks, description, operationDate } = input
    const operation = { kind, amountKopecks, description, operationDate }
    const existing = await replayOperation(tx, userId, idempotencyKey)
    if (existing) return existing
    if (
      operation.operationDate &&
      !(await isValidOperationDate(tx, operation.operationDate, submittedAt))
    ) {
      return 'date_invalid'
    }
    const category = categoryId
      ? await lockActiveCategoryAssignment(tx, userId, categoryId, 'no key update')
      : undefined
    if (categoryId && category?.kind !== operation.kind) {
      return (await replayOperation(tx, userId, idempotencyKey)) ?? 'category_unavailable'
    }
    const id = await insertOperation(tx, userId, operation, idempotencyKey, categoryId ?? undefined)
    if (id) {
      return {
        id,
        kind: operation.kind,
        categoryId,
        categoryName: category?.name ?? null,
        replayed: false,
        deleted: false,
      }
    }

    // A concurrent request committed the unique key while this insert was waiting.
    const winner = await replayOperation(tx, userId, idempotencyKey)
    if (!winner) throw new Error('FinanceBro could not read the operation after a key conflict')
    return winner
  }

  async function createOperation(input: OperationRequest) {
    const userId = await users.getOrCreateUser(input.telegramUserId)
    return db.transaction((tx) => writeOperation(tx, userId, input, now()))
  }

  async function createBatch(input: z.output<typeof structuredOperationBatchRequestSchema>) {
    const { idempotencyKey, telegramUserId } = input
    const userId = await users.getOrCreateUser(telegramUserId)
    const submittedAt = now()
    return db.transaction(async (tx) => {
      // Serialize retries before validating rows whose category may have changed.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${userId + ':batch:' + idempotencyKey}, 0))`,
      )
      const keyForRow = (index: number) => `batch:${idempotencyKey}:${index}`
      const first = await replayOperation(tx, userId, keyForRow(0))
      const rows: StructuredOperationResult[] = []
      if (first) {
        rows.push(first)
        for (let index = 1; index < input.rows.length; index++) {
          const existing = await replayOperation(tx, userId, keyForRow(index))
          if (!existing) throw new BatchWriteError('idempotency_conflict', index)
          rows.push(existing)
        }
        if (await replayOperation(tx, userId, keyForRow(input.rows.length))) {
          throw new BatchWriteError('idempotency_conflict', input.rows.length)
        }
        return rows
      }

      for (const [index, row] of input.rows.entries()) {
        const result = await writeOperation(
          tx,
          userId,
          {
            ...row,
            telegramUserId,
            idempotencyKey: keyForRow(index),
          },
          submittedAt,
        )
        if (typeof result === 'string') {
          throw new BatchWriteError(result, index)
        }
        if (result.replayed) throw new BatchWriteError('idempotency_conflict', index)
        rows.push(result)
      }
      return rows
    })
  }

  async function changeCategory(
    id: string,
    { telegramUserId, categoryId }: CategoryRequest,
  ): Promise<StructuredCategoryResult | 'operation_unavailable' | 'category_unavailable'> {
    const userId = await findUserIdByTelegramId(db, telegramUserId)
    if (!userId) return 'operation_unavailable'

    return db.transaction(async (tx) => {
      const kind = await readActiveOperationKind(tx, userId, id)
      if (!kind) return 'operation_unavailable'
      if (
        categoryId !== null &&
        (await lockActiveCategoryKind(tx, userId, categoryId, 'no key update')) !== kind
      ) {
        return 'category_unavailable'
      }
      if (!(await updateOperationCategory(tx, userId, id, categoryId, kind))) {
        return 'operation_unavailable'
      }
      return { id, kind, categoryId }
    })
  }

  return async function handleStructuredOperation(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): Promise<boolean> {
    const create = request.method === 'POST' && url.pathname === operationsPath
    const batch = request.method === 'POST' && url.pathname === batchPath
    const readReplay = request.method === 'GET' && url.pathname === replayPath
    const patch = request.method === 'PATCH' && operationPath.exec(url.pathname)
    if (!create && !batch && !readReplay && !patch) return false

    try {
      if (readReplay) {
        const query = operationReplayQuerySchema.safeParse({
          telegramUserId: url.searchParams.get('telegramUserId'),
          idempotencyKey: url.searchParams.get('idempotencyKey'),
        })
        if (url.searchParams.size !== 2 || !query.success) {
          sendJson(response, 400, { error: 'invalid_operation' })
          return true
        }
        const userId = await findUserIdByTelegramId(db, query.data.telegramUserId)
        const result = userId ? await replayOperation(db, userId, query.data.idempotencyKey) : null
        sendJson(response, 200, result)
        return true
      }
      const body = await readJson(request, batch ? 16 * 1024 : bodyLimit)
      if (batch) {
        const input = structuredOperationBatchRequestSchema.safeParse(body)
        if (!input.success) {
          sendJson(response, 400, { error: 'invalid_operation' })
          return true
        }
        const rows = await createBatch(input.data)
        sendJson(response, rows.every((row) => row.replayed) ? 200 : 201, { rows })
      } else if (patch) {
        const id = z.uuid().safeParse(patch[1])
        const input = structuredCategoryRequestSchema.safeParse(body)
        if (!id.success || !input.success) {
          sendJson(response, 400, { error: 'invalid_operation' })
          return true
        }
        const result = await changeCategory(id.data, input.data)
        if (typeof result === 'string') {
          sendJson(response, result === 'operation_unavailable' ? 404 : 409, { error: result })
        } else {
          sendJson(response, 200, result)
        }
      } else {
        const input = structuredOperationRequestSchema.safeParse(body)
        if (!input.success) {
          sendJson(response, 400, { error: 'invalid_operation' })
          return true
        }
        const result = await createOperation(input.data)
        if (typeof result === 'string') {
          sendJson(response, result === 'date_invalid' ? 400 : 409, { error: result })
        } else {
          sendJson(response, result.replayed ? 200 : 201, result)
        }
      }
    } catch (error) {
      if (error instanceof BatchWriteError) {
        sendJson(response, error.code === 'date_invalid' ? 400 : 409, {
          error: error.code,
          row: error.row,
        })
      } else if (error instanceof HttpRequestError) {
        if (error.status === 413 || error.status === 415) response.setHeader('Connection', 'close')
        sendJson(response, error.status, { error: error.code })
      } else {
        console.error('Не удалось обработать внутреннюю команду операции.')
        sendJson(response, 500, { error: 'transactions_unavailable' })
      }
    }
    return true
  }
}
