/**
 * Request guards — stage-door integration (docs/permissions.md).
 *
 * The session is the estate-wide `nnt-session` cookie sealed by
 * auth.newtheatre.org.uk. This app reads it and NEVER writes it
 * (CLAUDE.md invariant 1). Authorisation is entirely local.
 */

import type { H3Event } from 'h3'
import type { User } from '#auth-utils'
import { ROLE_NAMESPACE, useAbilities, type Abilities } from './abilities'

/**
 * Requires a valid estate session.
 *
 * @throws 401 if there is no session
 */
export async function requireAuth(event: H3Event): Promise<User> {
  const { user } = await getUserSession(event)
  if (!user) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
      message: 'You must be signed in to use the training system',
    })
  }
  return user
}

/**
 * Requires `training:ADMIN`.
 *
 * Privileged surfaces must not honour stale roles (session contract §rules):
 * if the session's last DB re-read is older than 15 minutes this rejects with
 * 401 and a `stale: true` hint, and the client middleware bounces the browser
 * through the auth service's refresh endpoint — which re-reads roles and
 * rejects disabled users and revoked sessions.
 *
 * @throws 401 unauthenticated or needs refresh · 403 not an admin
 */
export async function requireAdmin(event: H3Event): Promise<User> {
  const session = await getUserSession(event)

  if (!session.user) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  if (isStale(session)) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Session refresh required',
      data: { stale: true },
    })
  }

  if (!hasRole(session.user, ROLE_NAMESPACE, 'ADMIN')) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: 'This action is limited to the Theatre Manager and IT Manager',
    })
  }

  return session.user
}

/**
 * Requires authority over `department`: its lead, or an admin.
 *
 * Lead authority is app data, so it needs no staleness check — it isn't
 * carried in the session at all. Only the admin fallback does, which is why
 * leads never get bounced through a refresh for their own department.
 *
 * @throws 401/403 as above
 */
export async function requireDepartmentSteward(event: H3Event, department: string): Promise<Abilities> {
  const abilities = await useAbilities(event)

  if (abilities.leadOf.includes(department)) return abilities

  // Not a lead here — fall back to the admin path, staleness check included.
  await requireAdmin(event)
  return abilities
}

/** Requires stewardship of at least one department (for list/create screens). */
export async function requireAnySteward(event: H3Event): Promise<Abilities> {
  const abilities = await useAbilities(event)
  if (abilities.leadOf.length > 0) return abilities
  await requireAdmin(event)
  return abilities
}
