import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import {
  initDataAuthDatePattern,
  initDataFieldLineBreakPattern,
  initDataFieldNamePattern,
  initDataHashPattern,
} from './patterns.ts'

export const defaultInitDataMaxAgeSeconds = 3600
export const initDataMaxAgeSchema = z.int().positive()

const hashSchema = z.string().regex(initDataHashPattern)
const authDateSchema = z
  .string()
  .regex(initDataAuthDatePattern)
  .transform(Number)
  .pipe(z.int().positive())
const userSchema = z.object({ id: z.int().positive() })

export function createInitDataVerifier(botToken: string, maxAgeSeconds: number) {
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest()

  return (initData: string, now: Date): number | null => {
    const fields = new URLSearchParams(initData)
    const names = new Set<string>()
    for (const [name, value] of fields) {
      // Reject ambiguous fields before canonicalizing the signed data.
      if (
        names.has(name) ||
        !initDataFieldNamePattern.test(name) ||
        initDataFieldLineBreakPattern.test(value)
      )
        return null
      names.add(name)
    }

    const hash = hashSchema.safeParse(fields.get('hash'))
    if (!hash.success) return null
    fields.delete('hash')
    fields.sort()
    const dataCheckString = Array.from(fields, ([key, value]) => `${key}=${value}`).join('\n')
    const expectedHash = createHmac('sha256', secret).update(dataCheckString).digest()
    if (!timingSafeEqual(expectedHash, Buffer.from(hash.data, 'hex'))) return null

    const authDate = authDateSchema.safeParse(fields.get('auth_date'))
    if (!authDate.success) return null
    const age = Math.floor(now.getTime() / 1000) - authDate.data
    if (age < 0 || age > maxAgeSeconds) return null

    const user = fields.get('user')
    if (!user) return null
    try {
      const parsed = userSchema.safeParse(JSON.parse(user))
      return parsed.success ? parsed.data.id : null
    } catch {
      return null
    }
  }
}
