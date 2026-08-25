/**
 * Attaching a record to someone who has not signed in yet. Local ids are
 * NEVER invented here (CLAUDE.md invariant 7).
 */

import { db, schema } from '@nuxthub/db'
import { and, eq, isNull } from 'drizzle-orm'

interface ShadowUserResponse {
  id: string
  email: string
  name?: string
}

export async function findOrCreateAttendee(
  event: Parameters<typeof useRuntimeConfig>[0],
  { email, name }: { email: string, name?: string },
): Promise<{ id: string, name: string, created: boolean }> {
  const normalised = email.trim().toLowerCase()

  const existing = await db.select().from(schema.users)
    .where(eq(schema.users.email, normalised)).get()
  if (existing) {
    assertAttachable(existing)
    return { id: existing.id, name: existing.name, created: false }
  }

  const config = useRuntimeConfig(event)
  const token = config.authServiceToken
  const authBaseURL = config.public.authBaseURL

  if (!token) {
    // Dev convenience only, and it must never be reachable in production:
    // an id we invented would collide with nothing and match nothing.
    if (import.meta.dev) {
      const devId = `dev-shadow-${normalised.replace(/[^a-z0-9]/g, '-')}`
      await db.insert(schema.users)
        .values({ id: devId, email: normalised, name: name || normalised })
        .onConflictDoNothing()
      return { id: devId, name: name || normalised, created: true }
    }

    throw createError({
      statusCode: 503,
      statusMessage: 'Cannot add people by email: this app has no auth service token configured',
    })
  }

  let shadow: ShadowUserResponse
  try {
    shadow = await $fetch<ShadowUserResponse>(`${authBaseURL}/api/users/shadow`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: { email: normalised, name: name || normalised },
    })
  }
  catch {
    throw createError({
      statusCode: 503,
      statusMessage: 'The accounts service is unreachable: try adding this person again shortly',
    })
  }

  await db.insert(schema.users)
    .values({ id: shadow.id, email: normalised, name: shadow.name || name || normalised })
    .onConflictDoUpdate({
      target: schema.users.id,
      set: { email: normalised, name: shadow.name || name || normalised },
      // Same guard as the mirror upsert: an erased or merged-away row is
      // never written back over.
      setWhere: and(isNull(schema.users.anonymisedAt), isNull(schema.users.mergedInto)),
    })

  // The upsert leaves such a row alone rather than failing, so the refusal has
  // to be read back: an unattachable id would otherwise take a record.
  const mirrored = await db.select().from(schema.users)
    .where(eq(schema.users.id, shadow.id)).get()
  if (mirrored) assertAttachable(mirrored)

  return { id: shadow.id, name: shadow.name || name || normalised, created: true }
}

/** An erased or merged-away row is never written over, so never attached to. */
function assertAttachable(row: { anonymisedAt: Date | null, mergedInto: string | null }): void {
  if (!row.anonymisedAt && !row.mergedInto) return

  throw createError({
    statusCode: 409,
    statusMessage: 'That account has been erased or merged and cannot be added to a session',
  })
}
