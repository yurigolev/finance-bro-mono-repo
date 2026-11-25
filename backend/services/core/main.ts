import { once } from 'node:events'
import { z } from 'zod'
import { defaultInitDataMaxAgeSeconds, initDataMaxAgeSchema } from './analytics/init-data.ts'
import { createApplication } from './app.ts'
import { createCoreServer, createInternalHandler } from './http/server.ts'
import { createDatabase } from './db/client.ts'

const environmentSchema = z.object({
  BOT_TOKEN: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  CORE_SERVICE_TOKEN: z.string().min(1),
  ANALYTICS_HTTP_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  ANALYTICS_HTTP_HOST: z.string().min(1).default('127.0.0.1'),
  ANALYTICS_INIT_DATA_MAX_AGE_SECONDS: z.coerce
    .number()
    .pipe(initDataMaxAgeSchema)
    .default(defaultInitDataMaxAgeSeconds),
})

async function run() {
  const parsed = environmentSchema.safeParse(process.env)
  if (!parsed.success) {
    console.error('Некорректная конфигурация финансового ядра.')
    process.exitCode = 1
    return
  }

  const env = parsed.data
  const { db, pool } = createDatabase(env.DATABASE_URL)
  pool.on('error', () => console.error('Разорвано соединение с PostgreSQL.'))
  const app = createApplication(db)
  const server = createCoreServer(
    db,
    {
      botToken: env.BOT_TOKEN,
      maxAgeSeconds: env.ANALYTICS_INIT_DATA_MAX_AGE_SECONDS,
      handleInternal: createInternalHandler(db, app, env.CORE_SERVICE_TOKEN),
    },
    app,
  )
  const shutdown = new AbortController()
  const stop = () => shutdown.abort()
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  const stopped = once(shutdown.signal, 'abort')

  try {
    server.listen(env.ANALYTICS_HTTP_PORT, env.ANALYTICS_HTTP_HOST)
    await once(server, 'listening')
    console.info('HTTP API финансового ядра запущен.')
    await stopped
  } catch {
    console.error('Не удалось запустить HTTP API финансового ядра.')
    process.exitCode = 1
  } finally {
    process.off('SIGINT', stop)
    process.off('SIGTERM', stop)
    if (server.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
    await pool.end()
  }
}

await run()
