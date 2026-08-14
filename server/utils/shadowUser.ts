/**
 * Add-by-email: attaching a record to someone who has not signed in yet.
 *
 * Members are expected to sign in once before appearing in the attendee
 * picker, but a trainer with a room full of people cannot be blocked by that.
 * The auth service mints a shadow account for the address and returns its
 * canonical id, which we mirror — so when that person later signs in with
 * Google, the training they did today is already attached to the identity
 * they claim (CLAUDE.md invariant 7).
 *
 * Local ids are NEVER invented here. If the auth service is unreachable the
 * operation fails with a retry message rather than creating a user whose id
 * nothing else in the estate recognises (stage-door integrating-an-app §7).
 */

import { db, schema } from '@nuxthub/db'
import { eq } from 'drizzle-orm'

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
      statusMessage: 'The accounts service is unreachable — try adding this person again shortly',
    })
  }

  await db.insert(schema.users)
    .values({ id: shadow.id, email: normalised, name: shadow.name || name || normalised })
    .onConflictDoUpdate({
      target: schema.users.id,
      set: { email: normalised, name: shadow.name || name || normalised },
    })

  return { id: shadow.id, name: shadow.name || name || normalised, created: true }
}
