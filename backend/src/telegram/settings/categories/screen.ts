import { InlineKeyboard } from 'grammy'
import type { CategoryChoice, CategoryRule } from '../../../categories/types.ts'
import type { OperationKind } from '../../../transactions/types.ts'
import { kindHeading, kindLabel, kinds } from '../../operation-ui.ts'
import { callback, compactUuid, escapeHtml, pagedButtons } from '../../ui.ts'

const cataloguePageSize = 12
const rulesPageSize = 6

export const settingsBack = callback('⬅️ К настройкам', 'settings:menu')
export const categoryMessages = {
  staleName: 'Запрос имени устарел. Откройте «Настройки» и выберите действие снова.',
  duplicateName: 'Категория с таким именем уже есть. Ответьте на подсказку другим именем.',
  invalidName: 'Введите имя от 1 до 60 символов в ответ на подсказку.',
  added: 'Категория добавлена.',
  renamed: 'Категория переименована.',
  archived: 'Категория архивирована.',
  rulesLoadError: 'Не удалось загрузить запомненные слова.',
  rulesShowError: 'Не удалось показать запомненные слова.',
  rulesUpdateError: 'Не удалось обновить список правил.',
  ruleDeletedReopen: 'Правило удалено. Откройте список заново.',
  ruleDeleted: 'Правило удалено.',
  ruleStale: 'Правило уже удалено или изменилось.',
}

export function categoryRulesScreen(rules: CategoryRule[], requestedPage: number) {
  const lastPage = Math.max(0, Math.ceil(rules.length / rulesPageSize) - 1)
  const page = Math.min(requestedPage, lastPage)
  const start = page * rulesPageSize
  const title =
    lastPage > 0 ? `🧠 Запомненные слова · ${page + 1}/${lastPage + 1}` : '🧠 Запомненные слова'
  const lines: string[] = []
  const buttons = rules.slice(start, start + rulesPageSize).map((rule, index) => {
    const number = start + index + 1
    const archived = rule.archivedAt ? ' · Архивная категория' : ''
    lines.push(
      `${number}. ${rule.expression} → ${rule.categoryName ?? 'Отключено'} · ${kindLabel[rule.kind]}${archived}`,
    )
    return [
      callback(
        `🗑 Удалить №${number}`,
        `rd:${compactUuid(rule.id)}:${rule.categoryId ? compactUuid(rule.categoryId) : 'none'}:${page}`,
      ),
    ]
  })
  const navigation = []
  if (page > 0) navigation.push(callback('⬅️ Назад', `rules-page:${page - 1}`))
  if (page < lastPage) navigation.push(callback('➡️ Далее', `rules-page:${page + 1}`))
  if (navigation.length > 0) buttons.push(navigation)
  buttons.push([settingsBack])
  if (lines.length === 0) lines.push('Пока нет запомненных слов.')

  return {
    html: `<h2>${title}</h2><p>${lines.map(escapeHtml).join('<br>')}</p>`,
    text: `${title}\n\n${lines.join('\n')}`,
    keyboard: { reply_markup: new InlineKeyboard(buttons) },
  }
}

export function settingsScreen() {
  return {
    html: '<h2>🏷 Личные категории</h2>',
    text: '🏷 Личные категории',
    keyboard: {
      reply_markup: new InlineKeyboard([
        kinds.map((kind) => callback(kindHeading[kind], `catalog:${kind}:0`)),
        [callback('🧠 Запомненные слова', 'rules:0'), callback('📚 Встроенные слова', 'bw:menu')],
      ]),
    },
  }
}

export function categoryCatalogueScreen(
  kind: OperationKind,
  entries: CategoryChoice[],
  page: number,
  notice?: string,
) {
  const buttons = pagedButtons(
    entries,
    page,
    ({ id }) => `details:${kind}:${id}`,
    (index) => `catalog-page:${kind}:${index}`,
    cataloguePageSize,
  )
  buttons.push([callback('➕ Добавить категорию', `add:${kind}`)], [settingsBack])
  const title = kindHeading[kind]
  const lines = [notice, entries.length ? undefined : 'Нет активных категорий.'].filter(Boolean)
  return {
    html: `<h2>${title}</h2>${lines.map((line) => `<p>${line}</p>`).join('')}`,
    text: [title, ...lines].join('\n'),
    keyboard: { reply_markup: new InlineKeyboard(buttons) },
  }
}

export function categoryDetailsScreen(kind: OperationKind, { id, name }: CategoryChoice) {
  const title = `🏷 Категория «${name}»`
  return {
    html: `<h2>${escapeHtml(title)}</h2>`,
    text: title,
    keyboard: {
      reply_markup: new InlineKeyboard([
        [
          callback('✏️ Переименовать', `rename:${kind}:${id}`),
          callback('📦 Архивировать', `archive:${kind}:${id}`),
        ],
        [callback('⬅️ К категориям', `catalog:${kind}:0`)],
      ]),
    },
  }
}

export function categoryNamePrompt(kind: OperationKind, currentName?: string) {
  const text =
    currentName === undefined
      ? `🏷 Введите название категории (до 60 символов). Раздел — ${kindLabel[kind]}.`
      : `🏷 Введите новое название категории «${currentName}» (до 60 символов).`
  return { text, keyboard: { reply_markup: { force_reply: true as const } } }
}
