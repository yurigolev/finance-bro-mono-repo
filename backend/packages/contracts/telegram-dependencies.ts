import type { EndpointService, telegramContract } from './telegram.ts'
import type { OperationDraft, RecordOperationResult } from './transactions.ts'

type TelegramServices = {
  [Group in keyof typeof telegramContract]: EndpointService<(typeof telegramContract)[Group]>
}

export type TelegramDependencies = TelegramServices & {
  transactions: {
    recordOperation: (
      userId: string,
      input: OperationDraft,
      idempotencyKey: string,
    ) => Promise<RecordOperationResult>
  }
}
