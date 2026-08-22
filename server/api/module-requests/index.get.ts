/** GET /api/module-requests: your own requests, and the board if you lead. */

import { useAbilities } from '../../utils/abilities'
import { demandBoard, requestsFor } from '../../utils/moduleRequests'

export default defineEventHandler(async (event) => {
  const abilities = await useAbilities(event)

  // An admin sees every department; a lead sees theirs; everyone else sees
  // only their own requests.
  const canSeeBoard = abilities.isAdmin || abilities.leadOf.length > 0
  const scope = abilities.isAdmin ? null : abilities.leadOf

  const [mine, board] = await Promise.all([
    requestsFor(abilities.user.id),
    canSeeBoard ? demandBoard(scope) : Promise.resolve([]),
  ])

  return { mine, board, canSeeBoard }
})
