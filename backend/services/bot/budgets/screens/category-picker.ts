import { callback, compactUuid, pagedButtons, textScreen } from '../../ui.ts'

export function budgetCategoryPickerScreen(
  entries: { id: string; name: string }[],
  month: string,
  page: number,
) {
  const rows = pagedButtons(
    entries,
    page,
    ({ id }) => `b:scope:${month}:${compactUuid(id)}:0`,
    (nextPage) => `b:pick:${month}:${nextPage}`,
  )
  rows.push([callback('К бюджетам', `b:view:${month}:0`)])
  return textScreen(
    '🎯 Лимит по категории',
    entries.length ? 'Выберите категорию расходов.' : 'Нет активных категорий расходов.',
    rows,
  )
}
