import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './services/core/db/schema.ts',
  out: './services/core/drizzle',
  dbCredentials: process.env.DATABASE_URL ? { url: process.env.DATABASE_URL } : undefined,
})
