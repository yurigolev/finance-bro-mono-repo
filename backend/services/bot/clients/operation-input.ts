import {
  structuredCategoryResultSchema,
  structuredOperationBatchResultSchema,
  structuredOperationResultSchema,
  type StructuredOperationRequest,
} from '../../../packages/contracts/operations.ts'
import { createInputClient } from './input.ts'
import { inputContextSchema } from '../../../packages/contracts/input.ts'
import {
  recordParsedOperation,
  type TelegramInput,
  type TelegramOperationInput,
} from '../operation-input.ts'

const coreContextSchema = inputContextSchema.omit({ sentAt: true, kind: true })
const operations = '/internal/v1/operations'

export function createTelegramOperationInput({
  coreUrl,
  coreToken,
  inputUrl,
  inputToken,
  coreTimeoutMs = 5000,
}: {
  coreUrl: string
  coreToken: string
  inputUrl: string
  inputToken: string
  coreTimeoutMs?: number
}): TelegramInput & TelegramOperationInput {
  const input = createInputClient({ url: inputUrl, token: inputToken })

  async function request(path: string, method = 'GET', body?: string) {
    const response = await fetch(new URL(path, coreUrl), {
      method,
      headers: {
        Authorization: `Bearer ${coreToken}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(coreTimeoutMs),
    })
    const data: unknown = await response.json()
    return { response, data }
  }

  function errorCode(data: unknown) {
    return typeof data === 'object' && data !== null && 'error' in data ? data.error : undefined
  }

  const operationsClient: TelegramOperationInput = {
    ...input,
    async loadContext(telegramId) {
      const { response, data } = await request(`/internal/v1/users/${telegramId}/input-context`)
      if (!response.ok) throw new Error('FinanceBro input context unavailable')
      return coreContextSchema.parse(data)
    },
    async hasOperation(telegramId, idempotencyKey) {
      const query = new URLSearchParams({ telegramUserId: String(telegramId), idempotencyKey })
      const { response, data } = await request(`${operations}/replay?${query}`)
      if (!response.ok) throw new Error('FinanceBro operation lookup unavailable')
      return structuredOperationResultSchema.nullable().parse(data) !== null
    },
    async recordOperation(telegramId, operation, categoryId, idempotencyKey) {
      const payload: StructuredOperationRequest = {
        ...operation,
        amountKopecks: operation.amountKopecks.toString(),
        currency: 'RUB',
        telegramUserId: telegramId,
        categoryId,
        idempotencyKey,
      }
      const body = JSON.stringify(payload)
      let retrying = false
      const { response, data } = await request(operations, 'POST', body).catch(
        async (error: unknown) => {
          if (!(
            error instanceof TypeError ||
            (error instanceof DOMException && error.name === 'TimeoutError')
          )) {
            throw error
          }
          retrying = true
          return request(operations, 'POST', body)
        },
      )
      if (response.status === 409 && errorCode(data) === 'category_unavailable') {
        return { status: 'category-unavailable' }
      }
      if (response.status === 400 && errorCode(data) === 'date_invalid') {
        return { status: 'date-invalid' }
      }
      if (!response.ok) throw new Error('FinanceBro operation write unavailable')
      const result = structuredOperationResultSchema.parse(data)
      if (result.deleted || (result.replayed && !retrying)) return { status: 'duplicate' }
      return {
        status: 'created',
        id: result.id,
        kind: result.kind,
        categoryName: result.categoryName,
      }
    },
    async setCategory(telegramId, operationId, categoryId) {
      const { response, data } = await request(
        `${operations}/${encodeURIComponent(operationId)}`,
        'PATCH',
        JSON.stringify({ telegramUserId: telegramId, categoryId }),
      )
      if (response.status === 409 && errorCode(data) === 'category_unavailable') {
        return 'category-unavailable'
      }
      if (response.status === 404 && errorCode(data) === 'operation_unavailable') {
        return 'unavailable'
      }
      if (!response.ok) throw new Error('FinanceBro category write unavailable')
      structuredCategoryResultSchema.parse(data)
      return 'updated'
    },
  }
  return {
    ...input,
    ...operationsClient,
    async submitBatch(payload) {
      const { response, data } = await request(
        `${operations}/batch`,
        'POST',
        JSON.stringify(payload),
      )
      const code = errorCode(data)
      if (
        ((response.status === 409 && code === 'category_unavailable') ||
          (response.status === 400 && code === 'date_invalid')) &&
        data &&
        typeof data === 'object' &&
        'row' in data &&
        typeof data.row === 'number'
      ) {
        return {
          status: code === 'date_invalid' ? 'date-invalid' : 'category-unavailable',
          row: data.row,
        }
      }
      if (!response.ok) throw new Error('FinanceBro operation batch write unavailable')
      return { status: 'saved', rows: structuredOperationBatchResultSchema.parse(data).rows }
    },
    submit: (telegramId, draft, updateKey) =>
      recordParsedOperation(operationsClient, telegramId, draft, updateKey),
  }
}
