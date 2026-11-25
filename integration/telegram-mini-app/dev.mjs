import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rmdir, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

const root = fileURLToPath(new URL('../../', import.meta.url))
const envFile = join(root, 'backend/.env.mini-app.test')
const project = 'financebro-miniapp-test'
const menuScript = fileURLToPath(new URL('./telegram-menu.mjs', import.meta.url))

function run(command, args, env) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} завершился с ошибкой.`)
}

async function checkApp(origin, signal) {
  const deadline = Date.now() + 60_000
  do {
    const probeSignal = AbortSignal.any([signal, AbortSignal.timeout(5_000)])
    const [page, api] = await Promise.all(
      ['/', '/api/analytics/overview?period=current-month'].map(async (path) => {
        try {
          const response = await fetch(new URL(path, origin), {
            redirect: 'error',
            signal: probeSignal,
          })
          await response.body?.cancel()
          return response.status
        } catch {
          return undefined
        }
      }),
    )
    if (page === 200 && api === 401) return
    await delay(1_000, undefined, { signal })
  } while (Date.now() < deadline)
  throw new Error(`Mini App по адресу ${origin} не вернул 200 для страницы и 401 для API.`)
}

async function serveThroughTunnel(localUrl, env) {
  const lock = join(tmpdir(), `${project}-${process.getuid()}`)
  await mkdir(lock, { mode: 0o700 }).catch((error) => {
    if (error.code === 'EEXIST')
      throw new Error(`Уже есть сеанс туннеля или его блокировка: ${lock}`)
    throw error
  })

  const stop = new AbortController()
  const stopOnSignal = () => stop.abort()
  process.once('SIGINT', stopOnSignal)
  process.once('SIGTERM', stopOnSignal)
  let tunnel
  let backupDir
  let backup
  try {
    backupDir = await mkdtemp(join(tmpdir(), `${project}-menu-`))
    backup = join(backupDir, 'menu.json')
    const urlSignal = AbortSignal.any([stop.signal, AbortSignal.timeout(45_000)])
    tunnel = spawn('cloudflared', ['tunnel', '--url', localUrl], {
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    const tunnelClosed = once(tunnel, 'close').catch(() => [null])
    const publicUrl = await new Promise((resolve, reject) => {
      let output = ''
      tunnel.stderr.setEncoding('utf8').on('data', (chunk) => {
        process.stderr.write(chunk)
        output = (output + chunk).slice(-2_048)
        const url = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/i)?.[0]
        if (url) resolve(url)
      })
      tunnel.once('error', reject)
      tunnelClosed.then(() => {
        const error = new Error('HTTPS-туннель завершился.')
        stop.abort(error)
        reject(error)
      })
      urlSignal.addEventListener('abort', () => reject(urlSignal.reason), { once: true })
    })
    await checkApp(publicUrl, stop.signal)
    run(process.execPath, [menuScript, 'set', backup, publicUrl], env)
    console.log(`Откройте «Аналитика» у @${env.TEST_TELEGRAM_BOT_USERNAME.replace(/^@/, '')}.`)
    console.log(`${publicUrl} · Ctrl+C остановит туннель и восстановит меню.`)
    if (!stop.signal.aborted) await once(stop.signal, 'abort')
    throw stop.signal.reason
  } catch (error) {
    if (!stop.signal.aborted) throw error
    if (stop.signal.reason?.name !== 'AbortError') throw stop.signal.reason
  } finally {
    try {
      if (backup && existsSync(backup)) {
        try {
          run(process.execPath, [menuScript, 'restore', backup], env)
        } catch (error) {
          throw new Error(`Не удалось восстановить меню. Снимок сохранён: ${backup}`, {
            cause: error,
          })
        }
        await unlink(backup)
      }
      if (backupDir) await rmdir(backupDir)
    } finally {
      tunnel?.kill()
      process.removeListener('SIGINT', stopOnSignal)
      process.removeListener('SIGTERM', stopOnSignal)
      await rmdir(lock)
    }
  }
}

async function main() {
  const [action, ...extra] = process.argv.slice(2)
  if (!['start', 'refresh'].includes(action) || extra.length) {
    throw new Error('Использование: node integration/telegram-mini-app/dev.mjs <start|refresh>')
  }
  const config = parseEnv(
    await readFile(envFile, 'utf8').catch((error) => {
      if (error.code === 'ENOENT')
        throw new Error(`Создайте ${envFile} по инструкции локального запуска.`)
      throw error
    }),
  )
  for (const name of [
    'BOT_TOKEN',
    'TEST_TELEGRAM_BOT_USERNAME',
    'POSTGRES_PASSWORD',
    'CORE_SERVICE_TOKEN',
    'INPUT_SERVICE_TOKEN',
  ]) {
    if (!config[name]) throw new Error(`Заполните ${name} в ${envFile}.`)
  }
  const port = Number(config.MINI_APP_PORT ?? 8082)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('MINI_APP_PORT должен быть номером TCP-порта.')
  }
  const env = {
    ...process.env,
    ...config,
    DATABASE_URL: `postgresql://financebro:${encodeURIComponent(config.POSTGRES_PASSWORD)}@db:5432/financebro`,
    MINI_APP_PORT: String(port),
    TEST_TELEGRAM_BOT_TOKEN: config.BOT_TOKEN,
  }
  const localUrl = `http://127.0.0.1:${port}`
  run(
    'docker',
    [
      'compose',
      '--project-name',
      project,
      '--env-file',
      envFile,
      '--profile',
      'mini-app',
      'up',
      '-d',
      '--build',
      '--wait',
      '--wait-timeout',
      '120',
      'mini-app',
    ],
    env,
  )
  await checkApp(localUrl, new AbortController().signal)
  console.log(`Mini App готов: ${localUrl}. Страница 200, API без авторизации 401.`)
  if (action === 'start') await serveThroughTunnel(localUrl, env)
}

try {
  await main()
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
