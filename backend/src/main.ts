import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { createBatchSink, createRunner, createSource, type RunnerHandle } from '@grammyjs/runner'
import { GrammyError, HttpError } from 'grammy'
import type { Update } from 'grammy/types'
import { z } from 'zod'
import { createAnalyticsServer } from './analytics/http.ts'
import { defaultInitDataMaxAgeSeconds, initDataMaxAgeSchema } from './analytics/init-data.ts'
import { createApplication } from './app.ts'
import { createDatabase } from './db/client.ts'
import { createBot } from './telegram/bot.ts'
import { createVoiceTranscriber } from './telegram/operations/voice.ts'

const environmentSchema = z.object({
  BOT_TOKEN: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  WHISPER_URL: z.string().optional(),
  ANALYTICS_HTTP_PORT: z.string().optional(),
  ANALYTICS_HTTP_HOST: z.string().optional(),
  ANALYTICS_INIT_DATA_MAX_AGE_SECONDS: z.string().optional(),
})
const analyticsPortSchema = z.int().min(1).max(65535).optional()

async function run() {
  const environment = environmentSchema.safeParse(process.env)
  if (!environment.success) {
    console.error('Укажите BOT_TOKEN и DATABASE_URL в окружении.')
    process.exitCode = 1
    return
  }

  const {
    BOT_TOKEN,
    DATABASE_URL,
    WHISPER_URL,
    ANALYTICS_HTTP_PORT,
    ANALYTICS_HTTP_HOST,
    ANALYTICS_INIT_DATA_MAX_AGE_SECONDS,
  } = environment.data

  const port = analyticsPortSchema.safeParse(
    ANALYTICS_HTTP_PORT ? Number(ANALYTICS_HTTP_PORT) : undefined,
  )
  if (!port.success) {
    console.error('Укажите ANALYTICS_HTTP_PORT от 1 до 65535.')
    process.exitCode = 1
    return
  }
  const analyticsPort = port.data
  const maxAgeSeconds = initDataMaxAgeSchema.safeParse(
    analyticsPort === undefined
      ? defaultInitDataMaxAgeSeconds
      : Number(ANALYTICS_INIT_DATA_MAX_AGE_SECONDS ?? defaultInitDataMaxAgeSeconds),
  )
  if (!maxAgeSeconds.success) {
    console.error('Укажите положительное целое число ANALYTICS_INIT_DATA_MAX_AGE_SECONDS.')
    process.exitCode = 1
    return
  }

  const { db, pool } = createDatabase(DATABASE_URL)
  pool.on('error', () => console.error('Разорвано соединение с PostgreSQL.'))
  const app = createApplication(db)
  const analyticsServer =
    analyticsPort === undefined
      ? undefined
      : createAnalyticsServer({
          botToken: BOT_TOKEN,
          ...app.analytics,
          maxAgeSeconds: maxAgeSeconds.data,
        })

  const transcribeVoice = WHISPER_URL ? createVoiceTranscriber(WHISPER_URL) : undefined
  const bot = createBot(BOT_TOKEN, app.telegram, transcribeVoice)
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
    if (analyticsServer) {
      try {
        analyticsServer.listen(analyticsPort, ANALYTICS_HTTP_HOST || '127.0.0.1')
        await once(analyticsServer, 'listening')
      } catch {
        console.error('Не удалось запустить HTTP API аналитики.')
        process.exitCode = 1
        return
      }
    }

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
    // Handle updates concurrently within each batch and drain the batch before closing PostgreSQL.
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
    if (analyticsServer?.listening) {
      await new Promise<void>((resolve) => analyticsServer.close(() => resolve()))
    }
    await pool.end()
  }
}

await run()
