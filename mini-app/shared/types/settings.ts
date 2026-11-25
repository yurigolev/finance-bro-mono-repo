export type OperationKind = 'expense' | 'income'

export type SettingsCategory = { id: string; name: string; key: string | null }
export type SettingsRule = {
  id: string
  categoryId: string | null
  expression: string
  kind: OperationKind
  categoryName: string | null
  archivedAt: string | null
}
export type SettingsWordGroup = { kind: OperationKind; key: string; name: string; words: string[] }

export type Settings = {
  timeZone: string | null
  categories: Record<OperationKind, SettingsCategory[]>
  rules: SettingsRule[]
  groups: SettingsWordGroup[]
}

export type SettingsMutation =
  | { action: 'time-zone'; timeZone: string | null }
  | { action: 'add-category'; kind: OperationKind; name: string }
  | { action: 'rename-category'; id: string; name: string }
  | { action: 'archive-category'; id: string }
  | { action: 'delete-rule'; id: string; categoryId: string | null }
  | { action: 'change-word'; kind: OperationKind; word: string; target: string | null }
  | { action: 'bind-group'; kind: OperationKind; key: string; categoryId: string }
