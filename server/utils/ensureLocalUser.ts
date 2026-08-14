/**
 * Mirror upsert (stage-door docs/integrating-an-app.md §4).
 *
 * Records, sessions and leads FK a local `users` row; identity itself lives
 * centrally. On each authenticated request the session user is upserted into
 * the thin local mirror. Ids are the auth service's canonical ids and are
 * never minted here (CLAUDE.md invariant 7).
 */

import { db, schema } from '@nuxthub/db'
import type { User } from '#auth-utils'

const lastUpserted = new Map<string, number>()
const UPSERT_INTERVAL_MS = 60_000

export async function ensureLocalUser(user: Pick<User, 'id' | 'email' | 'name'>): Promise<void> {
  // Cheap per-isolate debounce — one upsert a minute per user is plenty.
  const last = lastUpserted.get(user.id)
  if (last && Date.now() - last < UPSERT_INTERVAL_MS) return

  await db.insert(schema.users)
    .values({ id: user.id, email: user.email, name: user.name })
    .onConflictDoUpdate({
      target: schema.users.id,
      set: { email: user.email, name: user.name, updatedAt: new Date() },
    })

  lastUpserted.set(user.id, Date.now())
}

/** Test seam — the debounce is per-isolate state. */
export function resetMirrorDebounce(): void {
  lastUpserted.clear()
}
