export type OperationKind = 'expense' | 'income'
export type OperationDate = { date: string; timeZone: string }

export type OperationInput = {
  kind: OperationKind
  amountKopecks: bigint
  description: string
  operationDate?: OperationDate
}

export type OperationDraft = Omit<OperationInput, 'kind'> & { kind?: OperationKind }
export type CategoryChoice = { id: string; name: string }

export type OperationSummary = Pick<OperationInput, 'kind' | 'amountKopecks' | 'description'> & {
  id: string
  createdAt: Date
  categoryName: string | null
}

export type OperationDetails = OperationSummary & {
  idempotencyKey: string
  operationDate: OperationDate
}

export type DailyHistory = {
  date: string
  today: string
  timeZone: string
  operations: OperationSummary[]
}

export type RecordOperationResult =
  | {
      status: 'created'
      id: string
      kind: OperationKind
      categoryName: string | null
      categoryChoices?: CategoryChoice[]
    }
  | { status: 'duplicate' }
  | { status: 'kind-required' }
