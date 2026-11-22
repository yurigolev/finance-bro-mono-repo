export type MonthlyBudget = {
  totalSpent: bigint
  totalLimit: bigint | null
  categories: { id: string; name: string; archived: boolean; limit: bigint; spent: bigint }[]
}

export type BudgetLimitChange = { kind: 'set'; amountKopecks: bigint | null } | { kind: 'disable' }

export type BudgetLimitResult = 'saved' | 'stale' | 'invalid' | 'unavailable'
