/**
 * Upserts the session user into the thin local mirror that records, sessions
 * and leads FK against. Ids are never minted here (invariant 7).
 */

import { db, schema } from '@nuxthub/db'
import { isNull } from 'drizzle-orm'
import type { User } from '#auth-utils'
import { hasRole } from '../../shared/utils/nntAuth'
import { ROLE_NAMESPACE } from './abilities'

const lastUpserted = new Map<string, number>()
const UPSERT_INTERVAL_MS = 60_000

export async function ensureLocalUser(user: Pick<User, 'id' | 'email' | 'name'> & { roles?: string[] }): Promise<void> {
  // Cheap per-isolate debounce: one upsert a minute per user is plenty.
  const last = lastUpserted.get(user.id)
  if (last && Date.now() - last < UPSERT_INTERVAL_MS) return

  // Derived cache for the expiry cron's digest fan-out only: the cron has no
  // session to read roles from. Never gate on it; see the schema comment.
  const isTrainingAdmin = hasRole({ roles: user.roles ?? [] }, ROLE_NAMESPACE, 'ADMIN')

  await db.insert(schema.users)
    .values({ id: user.id, email: user.email, name: user.name, isTrainingAdmin })
    .onConflictDoUpdate({
      target: schema.users.id,
      set: { email: user.email, name: user.name, isTrainingAdmin, updatedAt: new Date() },
      // An erased row is never written back over: the session cookie outlives
      // the erasure by up to 30 days and still carries the real name.
      setWhere: isNull(schema.users.anonymisedAt),
    })

  lastUpserted.set(user.id, Date.now())
}

/** Test seam: the debounce is per-isolate state. */
export function resetMirrorDebounce(): void {
  lastUpserted.clear()
}
