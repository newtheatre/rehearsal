/**
 * Per-consumer tokens for the read API, `read` scope only. A different prefix
 * from stage-door's so a token in the wrong secret fails loudly.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'
import { db, schema } from '@nuxthub/db'
import { eq } from 'drizzle-orm'

export const TOKEN_PREFIX = 'nnt_trn_'

export function hashServiceToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function generateServiceToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`
}

/** Create a token for a consumer. Returns the plaintext: shown once, never stored. */
export async function createServiceToken(name: string): Promise<{ id: string, token: string }> {
  const token = generateServiceToken()
  const [row] = await db.insert(schema.serviceTokens)
    .values({ name, tokenHash: hashServiceToken(token), scopes: 'read' })
    .returning()
  return { id: row!.id, token }
}

type ServiceTokenRow = typeof schema.serviceTokens.$inferSelect

function hasScope(row: ServiceTokenRow, scope: string): boolean {
  return row.scopes.split(',').map(s => s.trim()).includes(scope)
}

/**
 * Compared against each row in constant time; the table holds one per
 * consumer. Stamps `last_used_at`, which the runbook says to watch.
 */
export async function requireServiceToken(event: H3Event, scope = 'read'): Promise<ServiceTokenRow> {
  // Validated once per request: the subtree middleware has usually already
  // done it, and the lookup reads every token row.
  const cached = event.context.serviceToken as ServiceTokenRow | undefined
  if (cached && hasScope(cached, scope)) return cached

  const authorization = getRequestHeader(event, 'authorization')

  if (authorization?.startsWith(`Bearer ${TOKEN_PREFIX}`)) {
    const candidate = Buffer.from(hashServiceToken(authorization.slice('Bearer '.length)))

    const rows = await db.select().from(schema.serviceTokens).all()
    for (const row of rows) {
      const stored = Buffer.from(row.tokenHash)
      if (stored.length !== candidate.length) continue
      if (!timingSafeEqual(candidate, stored)) continue

      if (!hasScope(row, scope)) {
        throw createError({ statusCode: 403, statusMessage: 'Token scope does not allow this' })
      }

      await db.update(schema.serviceTokens)
        .set({ lastUsedAt: new Date() })
        .where(eq(schema.serviceTokens.id, row.id))

      event.context.serviceToken = row
      return row
    }
  }

  throw createError({ statusCode: 401, statusMessage: 'Invalid service token' })
}

/**
 * Consumers may cache for five minutes and are told to treat eligibility as
 * advisory-fresh (docs/consuming-the-api.md#freshness).
 */
export function setConsumerCacheHeaders(event: H3Event): void {
  setHeader(event, 'Cache-Control', 'private, max-age=300')
}
