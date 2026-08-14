/**
 * Auth for the hooks the central auth service calls
 * (stage-door docs/api-reference.md#app-hooks).
 *
 * The bearer is the SHA-256 of this app's own service token: the auth
 * service sends the hash it stores, we derive the same hash from our
 * NUXT_AUTH_SERVICE_TOKEN secret and compare constant-time. No plaintext
 * ever travels, and the hash can't be replayed inbound against the auth
 * service.
 *
 * Copied from rooms — change it there and re-copy.
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
 * regardless of the caller's batch size. Ignoring this is what took
 * Proscenium down once.
 */
export const D1_PARAM_CHUNK = 90

export function chunk<T>(items: T[], size = D1_PARAM_CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
