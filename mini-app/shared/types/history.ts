import type { OperationKind } from './settings'

export type HistoryOperation = {
  id: string
  kind: OperationKind
  amountKopecks: string
  description: string
  categoryName: string | null
  categoryKey: string | null
  date: string
  time: string | null
}

export type HistoryMonth = {
  month: string
  today: string
  timeZone: string
  operations: HistoryOperation[]
}
