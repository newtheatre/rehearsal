/**
 * Per-consumer tokens for the read API (docs/api-reference.md).
 *
 * Plaintext `nnt_trn_…` is shown once at creation; only the SHA-256 is stored.
 * Same shape as stage-door's `nnt_svc_` tokens — different prefix so a token
 * pasted into the wrong app's secret fails loudly rather than subtly.
 *
 * Scope is `read` and only `read`: this API answers questions about training,
 * it never accepts changes (CLAUDE.md invariant 8).
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

/** Create a token for a consumer. Returns the plaintext — shown once, never stored. */
export async function createServiceToken(name: string): Promise<{ id: string, token: string }> {
  const token = generateServiceToken()
  const [row] = await db.insert(schema.serviceTokens)
    .values({ name, tokenHash: hashServiceToken(token), scopes: 'read' })
    .returning()
  return { id: row!.id, token }
}

type ServiceTokenRow = typeof schema.serviceTokens.$inferSelect

/**
 * Authenticate a consumer request by its `Authorization: Bearer` token.
 *
 * The table holds a handful of rows (one per consumer), so this compares
 * against each in constant time rather than looking the hash up directly —
 * cheap here, and it keeps the comparison off the query planner.
 *
 * Stamps `last_used_at`, which the runbook says to watch: a stale stamp on a
 * consumer that should be calling means someone's secret is wrong.
 */
export async function requireServiceToken(event: H3Event, scope = 'read'): Promise<ServiceTokenRow> {
  const authorization = getRequestHeader(event, 'authorization')

  if (authorization?.startsWith(`Bearer ${TOKEN_PREFIX}`)) {
    const candidate = Buffer.from(hashServiceToken(authorization.slice('Bearer '.length)))

    const rows = await db.select().from(schema.serviceTokens).all()
    for (const row of rows) {
      const stored = Buffer.from(row.tokenHash)
      if (stored.length !== candidate.length) continue
      if (!timingSafeEqual(candidate, stored)) continue

      if (!row.scopes.split(',').map(s => s.trim()).includes(scope)) {
        throw createError({ statusCode: 403, statusMessage: 'Token scope does not allow this' })
      }

      await db.update(schema.serviceTokens)
        .set({ lastUsedAt: new Date() })
        .where(eq(schema.serviceTokens.id, row.id))

      return row
    }
  }

  throw createError({ statusCode: 401, statusMessage: 'Invalid service token' })
}

/**
 * Consumers may cache for five minutes; the guide tells them to treat
 * eligibility as advisory-fresh rather than transactional
 * (docs/consuming-the-api.md#freshness).
 */
export function setConsumerCacheHeaders(event: H3Event): void {
  setHeader(event, 'Cache-Control', 'private, max-age=300')
}
