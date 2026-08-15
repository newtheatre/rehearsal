/**
 * The bearer is the SHA-256 of this app's service token, compared
 * constant-time. No plaintext travels.
 */

import { createHash, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'

export function requireHookAuth(event: H3Event): void {
  const token = useRuntimeConfig(event).authServiceToken
  const authorization = getRequestHeader(event, 'authorization')

  if (token && authorization?.startsWith('Bearer ')) {
    const expected = Buffer.from(createHash('sha256').update(token).digest('hex'))
    const presented = Buffer.from(authorization.slice('Bearer '.length))
    if (expected.length === presented.length && timingSafeEqual(expected, presented)) {
      return
    }
  }

  throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
}

/**
 * D1 caps bound parameters at 100 per statement — chunk any `in (…)` list
 * regardless of the caller's batch size.
 */
export const D1_PARAM_CHUNK = 90

export function chunk<T>(items: T[], size = D1_PARAM_CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
