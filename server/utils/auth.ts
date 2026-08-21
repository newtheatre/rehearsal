/**
 * Request guards. The session is read, never written (CLAUDE.md invariant 1);
 * authorisation is entirely local. docs/permissions.md
 */

import type { H3Event } from 'h3'
import type { User } from '#auth-utils'
import { isStale } from '@newtheatre/auth-types'
import { useAbilities, type Abilities } from './abilities'
import { can, type Permission } from '../../shared/utils/permissions'

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
 * Requires authority over `department`: its lead, or an admin holding
 * `permission`. Lead authority is app data, so only the fallback is checked.
 */
export async function requireDepartmentSteward(
  event: H3Event,
  department: string,
  permission: Permission,
): Promise<Abilities> {
  const abilities = await useAbilities(event)

  if (abilities.leadOf.includes(department)) return abilities

  // Not a lead here, so this needs authority over every department instead.
  await requirePermission(event, permission)
  return abilities
}

/**
 * Requires the ability to deliver training, derived from the record at
 * request time (ADR-0004). Leads qualify too: they carry more authority.
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
