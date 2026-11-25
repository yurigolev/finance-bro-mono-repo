import {
  telegramContract,
  telegramEndpointPrefix,
  type EndpointGroup,
  type EndpointResult,
  type EndpointService,
} from '../../../packages/contracts/telegram.ts'
import type { TelegramDependencies } from '../dependencies.ts'

type TelegramCoreClientOptions = {
  baseUrl: string
  token: string
  timeoutMs?: number
}

export function createTelegramCoreClient({
  baseUrl,
  token,
  timeoutMs = 5000,
}: TelegramCoreClientOptions): TelegramDependencies {
  function bindGroup<Group extends EndpointGroup>(
    name: string,
    group: Group,
  ): EndpointService<Group> {
    const handlers = {} as EndpointService<Group>
    for (const method in group) {
      const { args, result } = group[method]!
      const url = new URL(`${telegramEndpointPrefix}/${name}/${method}`, baseUrl)
      handlers[method] = async (...values) => {
        // JSON converts undefined array entries into null. Omit trailing optional arguments.
        while (values.length > 0 && values.at(-1) === undefined) values.pop()
        const response = await fetch(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(args.encode(values)),
          redirect: 'error',
          signal: AbortSignal.timeout(timeoutMs),
        })
        if (!response.ok) throw new Error(`FinanceBro core returned HTTP ${response.status}`)
        return result.parse(await response.json()) as EndpointResult<Group[typeof method]>
      }
    }
    return handlers
  }

  return {
    users: bindGroup('users', telegramContract.users),
    categories: bindGroup('categories', telegramContract.categories),
    transactions: {
      ...bindGroup('transactions', telegramContract.transactions),
      async recordOperation() {
        throw new Error('FinanceBro remote bot requires structured operation input')
      },
    },
    budgets: bindGroup('budgets', telegramContract.budgets),
  }
}
