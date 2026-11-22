import type { BuiltInTarget, CategoryRule } from '../../../categories/types.ts'
import type { OperationKind } from '../../../transactions/types.ts'
import { kindLabel } from '../../operation-ui.ts'
import { buttonPageSize, callback, compactUuid, pagedButtons, textScreen } from '../../ui.ts'
import { settingsBack } from '../categories/screen.ts'

type BuiltInGroup = { key: string; name: string; kind: OperationKind; words: readonly string[] }
export type BuiltInWord = { group: BuiltInGroup; word: string; id: string }

export const wordSearchPrompt = {
  text: '🔎 Введите слово или фразу из встроенного словаря.',
  keyboard: { reply_markup: { force_reply: true as const } },
}
export const wordMessages = {
  error: '⚠️ Не удалось обновить встроенные слова. Попробуйте позже.',
  noResults: '🔎 Такой фразы нет во встроенном словаре.',
  bound: 'Категория подключена.',
}

export function builtInWordsMenu(groups: BuiltInGroup[]) {
  return textScreen('📚 Встроенные слова', 'Выберите категорию или найдите слово.', [
    [callback('🔎 Найти слово', 'bw:find')],
    ...groups.map(({ key, name }) => [callback(name, `bg:${key}`)]),
    [settingsBack],
  ])
}

export function builtInWordDetailsScreen(
  { group, word, id }: BuiltInWord,
  { target, rule }: { target?: BuiltInTarget; rule: CategoryRule | null },
) {
  const standard = target?.name ?? 'Категория не подключена'
  const personal = rule?.categoryId === null ? 'Отключено' : rule?.categoryName
  const status = personal
    ? `По умолчанию — ${standard}. Ваше правило — ${personal}${rule?.archivedAt ? ' (архив)' : ''}.`
    : standard
  const actions = [
    [callback('Сменить категорию', `bp:${id}:0`), callback('Отключить', `bm:${id}:off`)],
  ]
  if (rule) actions.push([callback('Вернуть стандартную', `bm:${id}:reset`)])
  const index = group.words.findIndex((entry) => entry === word)
  const page = Math.floor(index / buttonPageSize)
  actions.push([callback('⬅️ К категории', `bg:${group.key}:${page}`)])
  return textScreen(`📚 «${word}» · ${kindLabel[group.kind]}`, status, actions)
}

export function wordSearchResultsScreen(text: string, results: BuiltInWord[]) {
  return textScreen('🔎 Найденные слова', text, [
    ...results.map(({ group, id }) => [callback(kindLabel[group.kind], `bw:${id}`)]),
    [callback('⬅️ К словарю', 'bw:menu')],
  ])
}

export function builtInWordGroupScreen(
  group: BuiltInGroup,
  entries: { name: string; id: string }[],
  requestedPage: number,
  target?: BuiltInTarget,
) {
  const pages = Math.ceil(entries.length / buttonPageSize)
  const page = Math.min(requestedPage, pages - 1)
  const buttons = pagedButtons(
    entries,
    page,
    ({ id }) => `bw:${id}`,
    (index) => `bg:${group.key}:${index}`,
  )
  if (!target) buttons.push([callback('Подключить категорию', `bt:${group.key}:0`)])
  buttons.push([callback('⬅️ К словарю', 'bw:menu')])
  return textScreen(
    `${group.name} · ${page + 1}/${pages}`,
    target
      ? `Категория по умолчанию — ${target.name}.`
      : 'Выберите, в какую вашу категорию будут попадать эти слова.',
    buttons,
  )
}

export function builtInCategoryPickerScreen(
  action: string,
  id: string,
  page: number,
  name: string,
  available: BuiltInTarget[],
) {
  const buttons = pagedButtons(
    available,
    page,
    (category) => `${action === 'bp' ? 'bm' : 'bb'}:${id}:${compactUuid(category.id)}`,
    (nextPage) => `${action}:${id}:${nextPage}`,
  )
  buttons.push([callback('⬅️ Назад', action === 'bp' ? `bw:${id}` : `bg:${id}`)])
  return textScreen(
    '🏷 Выберите категорию',
    available.length ? name : 'Нет доступных категорий. Добавьте категорию в настройках.',
    buttons,
  )
}

export function builtInGroupBoundScreen({ key, name }: BuiltInGroup) {
  return textScreen(name, wordMessages.bound, [[callback('К словам категории', `bg:${key}`)]])
}
