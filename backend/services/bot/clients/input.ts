import type { ZodType } from 'zod'
import {
  budgetLimitResultSchema,
  operationDateResultSchema,
  type DateAnswerContext,
  parseErrorSchema,
  parseResultSchema,
  type InputContext,
  type InputResponse,
} from '../../../packages/contracts/input.ts'

export function createInputClient({
  url,
  token,
  timeoutMs = 55_000,
}: {
  url: string
  token: string
  timeoutMs?: number
}) {
  async function parse<Result>(
    path: string,
    body: FormData | string,
    schema: ZodType<Result>,
  ): Promise<InputResponse<Result>> {
    const headers = new Headers({ Authorization: `Bearer ${token}` })
    if (typeof body === 'string') headers.set('Content-Type', 'application/json')

    const response = await fetch(new URL(path, url), {
      method: 'POST',
      headers,
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    })
    const data: unknown = await response.json()
    if (response.ok) return { ok: true, result: schema.parse(data) }
    return { ok: false, ...parseErrorSchema.parse(data) }
  }

  const operationPath = '/v1/parse?batch=true'
  return {
    parseText: (text: string, context: InputContext) =>
      parse(operationPath, JSON.stringify({ text, context }), parseResultSchema),
    parseAudio(audio: File, context: InputContext) {
      const form = new FormData()
      form.set('audio', audio)
      form.set('context', new Blob([JSON.stringify(context)], { type: 'application/json' }))
      return parse(operationPath, form, parseResultSchema)
    },
    parseBudgetLimit: (text: string) =>
      parse(
        '/v1/parse/answer',
        JSON.stringify({ kind: 'budget-limit', text }),
        budgetLimitResultSchema,
      ),
    parseDate: (text: string, context: DateAnswerContext) =>
      parse(
        '/v1/parse/answer',
        JSON.stringify({ kind: 'operation-date', text, ...context }),
        operationDateResultSchema,
      ),
  }
}
