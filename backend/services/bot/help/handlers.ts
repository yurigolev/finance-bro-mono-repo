import type { Composer, Context } from 'grammy'
import { menu } from '../ui.ts'
import { helpScreen } from './screen.ts'

export function showHelp(ctx: Context, start = false) {
  const { html, options } = helpScreen(start)
  return ctx.reply(html, options)
}

export function registerHelpHandlers<C extends Context>(bot: Composer<C>) {
  bot.command('start', (ctx) => showHelp(ctx, true))
  bot.command('help', (ctx) => showHelp(ctx))
  bot.on('message:text').hears([menu.help, 'Помощь'], (ctx) => showHelp(ctx))
}
