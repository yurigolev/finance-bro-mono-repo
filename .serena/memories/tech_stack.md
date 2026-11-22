# Planned stack

- Telegram MVP stack approved for the first implementation: Node.js 24 LTS, TypeScript 7, npm, Telegraf 4.16 in long-polling mode, PostgreSQL 18, pg 8, Drizzle ORM 0.45 and Drizzle Kit 0.31 with checked-in SQL migrations. Docker Compose runs one bot and PostgreSQL on an internal network with a named volume. No public endpoint is needed. See `docs/planning/02-telegram-mvp.md` for implementation order.
- Keep Telegram handlers separate from transaction logic, so the same backend can expose an HTTP API for future clients. Backend and database are planned, not implemented yet.
- Existing `web/` is a Nuxt browser-storage demo. Standalone mobile and web are deferred. The native Swift/SwiftUI and SwiftData spike is paused.