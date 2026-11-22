import type { OperationKind } from '../transactions/types.ts'

export type CategoryChoice = { id: string; name: string }
export type BuiltInTarget = CategoryChoice & { key: string | null }
export type CategoryWriteResult = 'ok' | 'duplicate' | 'invalid' | 'unavailable'
export type CategoryRule = {
  id: string
  categoryId: string | null
  expression: string
  kind: OperationKind
  categoryName: string | null
  archivedAt: Date | null
}

export type CategoryService = {
  listCategories: (userId: string, kind: OperationKind) => Promise<CategoryChoice[]>
  addCategory: (userId: string, kind: OperationKind, name: string) => Promise<CategoryWriteResult>
  renameCategory: (userId: string, id: string, name: string) => Promise<CategoryWriteResult>
  archiveCategory: (userId: string, id: string) => Promise<boolean>
  setCategory: (userId: string, operationId: string, categoryId: string | null) => Promise<boolean>
  canRememberCategory: (
    userId: string,
    kind: OperationKind,
    description: string,
  ) => Promise<boolean>
  rememberCategory: (userId: string, operationId: string, categoryId: string) => Promise<boolean>
  listCategoryRules: (userId: string) => Promise<CategoryRule[]>
  deleteCategoryRule: (userId: string, id: string, categoryId: string | null) => Promise<boolean>
  listBuiltInTargets: (userId: string, kind: OperationKind) => Promise<BuiltInTarget[]>
  getBuiltInRule: (
    userId: string,
    kind: OperationKind,
    word: string,
  ) => Promise<CategoryRule | null>
  changeBuiltInRule: (
    userId: string,
    kind: OperationKind,
    word: string,
    target: string | null | 'reset',
  ) => Promise<boolean>
  bindBuiltInGroup: (
    userId: string,
    kind: OperationKind,
    key: string,
    categoryId: string,
  ) => Promise<boolean>
}
