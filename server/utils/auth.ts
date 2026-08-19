/**
 * Request guards. The session is read, never written (CLAUDE.md invariant 1);
 * authorisation is entirely local. docs/permissions.md
 */

import type { H3Event } from 'h3'
import type { User } from '#auth-utils'
import { useAbilities, type Abilities } from './abilities'
import { can, type Permission } from '../../shared/utils/permissions'

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
 * Requires a named permission from appManifest.ts. Staleness first, so a role
 * over 15 minutes old refreshes rather than silently failing the check.
 */
export async function requirePermission(event: H3Event, permission: Permission): Promise<User> {
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

  if (!can(session.user, permission)) {
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

  // Not a lead here — needs authority over every department instead.
  await requirePermission(event, 'signoff.any')
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
