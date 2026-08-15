/**
 * GET /api/me — who the caller is and what they may do.
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
