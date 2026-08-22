/**
 * Who may steward one session. Leadership is app data, so an admin fallback
 * is the only role check (docs/permissions.md).
 */

import type { Abilities } from './abilities'
import type { SessionRow } from './sessions'

/** The trainer who owns it, whoever created it, or an admin. */
export function maySteward(session: SessionRow, abilities: Abilities): boolean {
  return abilities.isAdmin
    || session.trainerUserId === abilities.user.id
    || session.createdBy === abilities.user.id
    || abilities.leadOf.length > 0
}

export function assertMaySteward(session: SessionRow, abilities: Abilities): void {
  if (maySteward(session, abilities)) return
  throw createError({
    statusCode: 403,
    statusMessage: 'Only the trainer running this session, or a department lead, can change it',
  })
}
