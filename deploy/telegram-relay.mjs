import { chmodSync, rmSync } from 'node:fs'
import { createConnection, createServer } from 'node:net'

const socketPath = '/telegram-socket/telegram.sock'
const wireGuardSide = process.argv[2] === 'wireguard'
const destination = wireGuardSide ? { host: 'api.telegram.org', port: 443 } : { path: socketPath }

const server = createServer((client) => {
  const upstream = createConnection(destination)
  function closePair() {
    client.destroy()
    upstream.destroy()
  }
  for (const socket of [client, upstream]) {
    socket.on('error', closePair)
    socket.setTimeout(120_000, closePair)
  }
  upstream.once('connect', () => {
    client.pipe(upstream)
    upstream.pipe(client)
  })
})
server.maxConnections = 64

if (wireGuardSide) {
  rmSync(socketPath, { force: true })
  server.listen(socketPath, () => chmodSync(socketPath, 0o600))
} else {
  server.listen(443, '0.0.0.0')
}
