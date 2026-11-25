export const readError = '⚠️ Не удалось загрузить операции. Попробуйте позже.'
export const writeError =
  '⚠️ Не удалось подтвердить запись. Проверьте «Историю» перед повторной отправкой.'
export const categoryError = '⚠️ Не удалось выполнить действие с категорией. Попробуйте позже.'
export const noCategory = 'Без категории'
export const kindIcon = { expense: '📉', income: '📈' } as const
export const kindLabel = { expense: 'Расходы', income: 'Доходы' } as const
export const kindHeading = {
  expense: `${kindIcon.expense} Расходы`,
  income: `${kindIcon.income} Доходы`,
} as const
export const kinds = ['expense', 'income'] as const
