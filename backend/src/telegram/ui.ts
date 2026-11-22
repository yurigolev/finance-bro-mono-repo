import { GrammyError, InlineKeyboard, Keyboard, type Context } from 'grammy'
import type { InlineKeyboardMarkup, InputRichMessage } from 'grammy/types'
import { missingEditableMessagePattern, unhyphenatedUuidPattern } from './patterns.ts'

export const menu = {
  statistics: '📊 Статистика',
  history: '📅 История',
  budgets: '🎯 Бюджеты',
  settings: '⚙️ Настройки',
  help: '❓ Помощь',
} as const
export const mainKeyboard = {
  reply_markup: Keyboard.from([
    [menu.statistics, menu.history],
    [menu.settings, menu.help],
    [menu.budgets],
  ])
    .resized()
    .persistent()
    .placeholder('480 кофе'),
}

export const callback = InlineKeyboard.text
export const unavailable = 'Действие больше недоступно.'
export const buttonPageSize = 8
const rubleFormat = new Intl.NumberFormat('ru-RU')

export function compactUuid(id: string): string {
  return Buffer.from(id.replaceAll('-', ''), 'hex').toString('base64url')
}

export function expandUuid(compact: string): string {
  return Buffer.from(compact, 'base64url')
    .toString('hex')
    .replace(unhyphenatedUuidPattern, '$1-$2-$3-$4-$5')
}

export function formatAmount(amountKopecks: bigint, compact = false): string {
  const rubles = rubleFormat.format(amountKopecks / 100n)
  if (compact && amountKopecks % 100n === 0n) return `${rubles} ₽`
  const kopecks = (amountKopecks % 100n).toString().padStart(2, '0')
  return `${rubles},${kopecks} ₽`
}

export function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

export function isUnchanged(error: unknown) {
  return (
    error instanceof GrammyError &&
    error.error_code === 400 &&
    error.description.includes('message is not modified')
  )
}

export function isMissingEditableMessage(error: unknown) {
  return (
    error instanceof GrammyError &&
    error.error_code === 400 &&
    missingEditableMessagePattern.test(error.description)
  )
}

export type CompactScreen = {
  html: string
  keyboard: { reply_markup: InlineKeyboardMarkup }
}

export type RichScreen = CompactScreen & {
  text: string
  plainKeyboard?: CompactScreen['keyboard']
}

export function isPhotoMessage(ctx: Context, messageId?: number) {
  const source = ctx.msg
  return source !== undefined && source.message_id === messageId && 'photo' in source
}

export async function sendCompactScreen(
  ctx: Context,
  { html, keyboard }: CompactScreen,
  messageId?: number,
  photo = isPhotoMessage(ctx, messageId),
) {
  const options = { ...keyboard, parse_mode: 'HTML' as const }
  if (messageId === undefined) return ctx.reply(html, options)

  try {
    if (photo) {
      return await ctx.api.editMessageCaption(ctx.chat!.id, messageId, {
        ...options,
        caption: html,
        show_caption_above_media: true,
      })
    }
    return await ctx.api.editMessageText(ctx.chat!.id, messageId, html, options)
  } catch (error) {
    if (!isUnchanged(error)) throw error
  }
}

export async function sendRichScreen(
  ctx: Context,
  { html, text, keyboard, plainKeyboard = keyboard }: RichScreen,
  messageId?: number,
) {
  const richMessage: InputRichMessage = { html, skip_entity_detection: true }

  try {
    return messageId === undefined
      ? await ctx.replyWithRichMessage(richMessage, keyboard)
      : await ctx.api.editMessageText(ctx.chat!.id, messageId, richMessage, keyboard)
  } catch (error) {
    if (isUnchanged(error)) return
    if (!(error instanceof GrammyError) || (error.error_code !== 400 && error.error_code !== 404))
      throw error
    if (messageId !== undefined) {
      try {
        return await ctx.api.editMessageText(ctx.chat!.id, messageId, text, plainKeyboard)
      } catch (fallbackError) {
        if (!isUnchanged(fallbackError)) throw fallbackError
        return
      }
    }
    return ctx.reply(text, plainKeyboard)
  }
}

export function textScreen(title: string, text: string, buttons: ReturnType<typeof callback>[][]) {
  return {
    html: `<h2>${escapeHtml(title)}</h2><p>${escapeHtml(text)}</p>`,
    text: `${title}\n\n${text}`,
    keyboard: { reply_markup: new InlineKeyboard(buttons) },
  }
}

export function pagedButtons<Entry extends { name: string }>(
  entries: Entry[],
  requestedPage: number,
  select: (entry: Entry) => string,
  openPage: (page: number) => string,
  size = buttonPageSize,
) {
  const lastPage = Math.max(0, Math.ceil(entries.length / size) - 1)
  const page = Math.min(requestedPage, lastPage)
  const start = page * size
  const buttons = entries
    .slice(start, start + size)
    .map((entry) => [callback(entry.name, select(entry))])
  const navigation = []
  if (page > 0) navigation.push(callback('⬅️ Назад', openPage(page - 1)))
  if (page < lastPage) navigation.push(callback('➡️ Далее', openPage(page + 1)))
  if (navigation.length > 0) buttons.push(navigation)
  return buttons
}
