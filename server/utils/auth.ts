/**
 * Request guards. The session is read, never written (CLAUDE.md invariant 1);
 * authorisation is entirely local. docs/permissions.md
 */

import type { H3Event } from 'h3'
import type { User } from '#auth-utils'
import { ROLE_NAMESPACE, useAbilities, type Abilities } from './abilities'

/**
 * 401 if there is no valid estate session.
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
 * Requires `training:ADMIN`. A session whose roles are over 15 minutes old
 * gets 401 with `stale: true`, which the client turns into a refresh.
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
 * Requires authority over `department`: its lead, or an admin. Lead authority
 * is app data, so only the admin fallback needs a staleness check.
 */
export async function requireDepartmentSteward(event: H3Event, department: string): Promise<Abilities> {
  const abilities = await useAbilities(event)

  if (abilities.leadOf.includes(department)) return abilities

  // Not a lead here — fall back to the admin path, staleness check included.
  await requireAdmin(event)
  return abilities
}

/**
 * Requires the ability to deliver training, derived from the record at
 * request time (ADR-0004). Leads qualify too — they carry more authority.
 */
export async function requireTrainer(event: H3Event): Promise<Abilities> {
  const abilities = await useAbilities(event)

  if (abilities.isTrainer || abilities.leadOf.length > 0) return abilities

  throw createError({
    statusCode: 403,
    statusMessage: 'Forbidden',
    message: 'Logging a session needs a current Trainer certification',
  })
}

/** Requires stewardship of at least one department (for list/create screens). */
export async function requireAnySteward(event: H3Event): Promise<Abilities> {
  const abilities = await useAbilities(event)
  if (abilities.leadOf.length > 0) return abilities
  await requireAdmin(event)
  return abilities
}
