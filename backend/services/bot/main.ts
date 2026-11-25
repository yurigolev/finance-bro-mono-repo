import { setTimeout as delay } from 'node:timers/promises'
import { createBatchSink, createRunner, createSource, type RunnerHandle } from '@grammyjs/runner'
import { GrammyError, HttpError } from 'grammy'
import type { Update } from 'grammy/types'
import { z } from 'zod'
import { createBot } from './bot.ts'
import { createTelegramCoreClient } from './clients/core.ts'
import { createTelegramOperationInput } from './clients/operation-input.ts'

const environmentSchema = z.object({
  BOT_TOKEN: z.string().min(1),
  CORE_URL: z.url({ protocol: /^https?$/ }),
  CORE_SERVICE_TOKEN: z.string().min(1),
  INPUT_URL: z.url({ protocol: /^https?$/ }),
  INPUT_SERVICE_TOKEN: z.string().min(1),
})

async function run() {
  const environment = environmentSchema.safeParse(process.env)
  if (!environment.success) {
    console.error('Укажите BOT_TOKEN, CORE_URL, INPUT_URL и сервисные токены для Telegram-бота.')
    process.exitCode = 1
    return
  }

  const { BOT_TOKEN, CORE_URL, CORE_SERVICE_TOKEN, INPUT_URL, INPUT_SERVICE_TOKEN } =
    environment.data
  const dependencies = createTelegramCoreClient({ baseUrl: CORE_URL, token: CORE_SERVICE_TOKEN })
  const operationInput = createTelegramOperationInput({
    coreUrl: CORE_URL,
    coreToken: CORE_SERVICE_TOKEN,
    inputUrl: INPUT_URL,
    inputToken: INPUT_SERVICE_TOKEN,
  })
  const bot = createBot(BOT_TOKEN, dependencies, operationInput)
  const shutdown = new AbortController()
  // grammY's Node typings use the polyfill, while its client also accepts native signals.
  type TelegramSignal = Parameters<typeof bot.init>[0]
  const startupSignal = shutdown.signal as unknown as TelegramSignal
  let runner: RunnerHandle | undefined

  function stop() {
    shutdown.abort()
    if (runner?.isRunning()) void runner.stop()
  }

  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)

  try {
    await bot.init(startupSignal)
    await Promise.all([
      bot.api.deleteMyCommands(undefined, startupSignal),
      bot.api.deleteMyCommands({ scope: { type: 'all_private_chats' } }, startupSignal),
    ])
    await bot.api.deleteWebhook(undefined, startupSignal)
    if (shutdown.signal.aborted) return

    let lastUpdateId: number | undefined
    const source = createSource({
      async supply(batchSize, signal) {
        for (;;) {
          try {
            return await bot.api.getUpdates(
              {
                offset: (lastUpdateId ?? -1) + 1,
                limit: Math.min(batchSize, 100),
                timeout: 50,
                allowed_updates: ['message', 'callback_query'],
              },
              signal,
            )
          } catch (error) {
            if (signal.aborted) throw error
            let wait = 5000
            if (error instanceof GrammyError && error.error_code === 429) {
              wait = (error.parameters.retry_after ?? 5) * 1000
            } else if (!(
              error instanceof HttpError ||
              (error instanceof GrammyError && error.error_code >= 500)
            )) {
              throw error
            }
            await delay(wait, undefined, { signal: shutdown.signal })
          }
        }
      },
    })
    // Handle updates concurrently within each batch and drain the batch before finishing shutdown.
    const sink = createBatchSink<Update>(
      {
        consume: (update) => {
          lastUpdateId = update.update_id
          return bot.handleUpdate(update)
        },
      },
      async () => console.error('Не удалось обработать обновление Telegram.'),
    )
    console.info(`Токен проверен для @${bot.botInfo.username}. Запускаю long polling.`)
    runner = createRunner(source, sink)
    runner.start()
    await runner.task()
    if (shutdown.signal.aborted && lastUpdateId !== undefined) {
      // Confirm the drained batch without discarding pending updates on restart.
      const signal = AbortSignal.timeout(5000) as unknown as TelegramSignal
      await bot.api
        .getUpdates({ offset: lastUpdateId + 1, limit: 1, timeout: 0 }, signal)
        .catch(() => {})
    }
  } catch (error) {
    if (shutdown.signal.aborted) return
    if (error instanceof GrammyError && error.error_code === 409) {
      console.error('Telegram вернул 409. Проверьте, что на токен запущен один процесс.')
    } else if (error instanceof GrammyError && error.error_code === 401) {
      console.error('Telegram отклонил BOT_TOKEN.')
    } else {
      console.error('Не удалось запустить или продолжить long polling.')
    }
    process.exitCode = 1
  } finally {
    process.off('SIGINT', stop)
    process.off('SIGTERM', stop)
  }
}

await run()
