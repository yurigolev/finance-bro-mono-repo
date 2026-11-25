import type { Composer, Context } from 'grammy'
import type { TelegramDependencies, WithOwner } from '../../dependencies.ts'
import { timeZoneScreen, timeZoneUpdateScreen } from './screen.ts'

type ProfileDependencies = Pick<TelegramDependencies['users'], 'getTimeZone' | 'setTimeZone'>

export function registerProfileCommands<C extends Context>(
  bot: Composer<C>,
  users: ProfileDependencies,
  withOwner: WithOwner,
) {
  bot.command('timezone', async (ctx) => {
    const value = ctx.match.trim()
    if (!value) {
      const timeZone = await withOwner(ctx.from!.id, (userId) => users.getTimeZone(userId))
      return ctx.reply(timeZoneScreen(timeZone))
    }

    const timeZone = value.toLowerCase() === 'reset' ? null : value
    const result = await withOwner(ctx.from!.id, (userId) => users.setTimeZone(userId, timeZone))
    return ctx.reply(timeZoneUpdateScreen(result))
  })
}
