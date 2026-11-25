import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { starterCategories } from '../../../packages/shared/categories/starter-categories.ts'
import type { TelegramDependencies } from '../../../packages/contracts/telegram-dependencies.ts'

const kind = z.enum(['expense', 'income'])
const id = z.uuid()
const name = z.string().max(120)
const mutation = z.discriminatedUnion('action', [
  z.object({ action: z.literal('time-zone'), timeZone: z.string().max(128).nullable() }),
  z.object({ action: z.literal('add-category'), kind, name }),
  z.object({ action: z.literal('rename-category'), id, name }),
  z.object({ action: z.literal('archive-category'), id }),
  z.object({ action: z.literal('delete-rule'), id, categoryId: id.nullable() }),
  z.object({
    action: z.literal('change-word'),
    kind,
    word: z.string().max(200),
    target: z.union([id, z.literal('reset'), z.null()]),
  }),
  z.object({ action: z.literal('bind-group'), kind, key: z.string().max(100), categoryId: id }),
])

const groups = (['expense', 'income'] as const).flatMap((kind) =>
  starterCategories[kind].map(({ key, name, words }) => ({ kind, key, name, words })),
)

async function readMutation(request: IncomingMessage) {
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
    const result = mutation.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    if (result.success) return { data: result.data }
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
  }
  return { error: 'invalid_settings', status: 400 } as const
}

export function createSettingsHandler({
  users,
  categories,
}: Pick<TelegramDependencies, 'users' | 'categories'>) {
  async function update(userId: string, input: z.infer<typeof mutation>) {
    switch (input.action) {
      case 'time-zone': {
        const result = await users.setTimeZone(userId, input.timeZone)
        return typeof result === 'string' ? result : 'ok'
      }
      case 'add-category':
        return categories.addCategory(userId, input.kind, input.name)
      case 'rename-category':
        return categories.renameCategory(userId, input.id, input.name)
      case 'archive-category':
        return (await categories.archiveCategory(userId, input.id)) ? 'ok' : 'unavailable'
      case 'delete-rule':
        return (await categories.deleteCategoryRule(userId, input.id, input.categoryId))
          ? 'ok'
          : 'unavailable'
      case 'change-word':
        return (await categories.changeBuiltInRule(userId, input.kind, input.word, input.target))
          ? 'ok'
          : 'unavailable'
      case 'bind-group':
        return (await categories.bindBuiltInGroup(userId, input.kind, input.key, input.categoryId))
          ? 'ok'
          : 'unavailable'
    }
  }

  return async function handleSettings(
    request: IncomingMessage,
    response: ServerResponse,
    telegramId: number,
    sendJson: (response: ServerResponse, status: number, body: object) => void,
  ) {
    try {
      if (request.method === 'GET') {
        const userId = await users.getOrCreateUser(telegramId)
        const [timeZone, expense, income, rules] = await Promise.all([
          users.getTimeZone(userId),
          categories.listBuiltInTargets(userId, 'expense'),
          categories.listBuiltInTargets(userId, 'income'),
          categories.listCategoryRules(userId),
        ])
        for (const list of [expense, income]) {
          list.sort((first, second) => first.name.localeCompare(second.name, 'ru'))
        }
        sendJson(response, 200, { timeZone, categories: { expense, income }, rules, groups })
        return
      }
      const input = await readMutation(request)
      if (input.error) {
        sendJson(response, input.status, { error: input.error })
        return
      }
      const userId = await users.getOrCreateUser(telegramId)
      const result = await update(userId, input.data)
      if (result === 'ok') {
        response.writeHead(204, { 'Cache-Control': 'no-store' }).end()
        return
      }
      sendJson(response, result === 'invalid' ? 400 : 409, { error: result })
    } catch {
      console.error('Не удалось обработать настройки Mini App.')
      sendJson(response, 500, { error: 'settings_unavailable' })
    }
  }
}
