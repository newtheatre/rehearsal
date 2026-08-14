/**
 * GET /api/me — who the caller is and what they may do.
 *
 * Two of the three sources of authority (department leads, trainer standing)
 * are app data the session knows nothing about, so the client has to ask.
 * This is for rendering, never for gating: every privileged action re-checks
 * server-side (docs/permissions.md).
 */

import { useAbilities } from '../utils/abilities'

export default defineEventHandler(async (event) => {
  const { user, isAdmin, leadOf, isTrainer } = await useAbilities(event)

  return {
    user: { id: user.id, name: user.name, email: user.email },
    isAdmin,
    leadOf,
    isTrainer,
    canSeeDrafts: isAdmin || leadOf.length > 0,
  }
})
