/** GET /api/module-requests: your own requests, and the board if you lead. */

import { z } from 'zod'
import { useAbilities } from '../../utils/abilities'
import { demandBoard, requestsFor } from '../../utils/moduleRequests'

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

export default defineEventHandler(async (event) => {
  const abilities = await useAbilities(event)
  const { limit } = await getValidatedQuery(event, querySchema.parse)

  // An admin sees every department; a lead sees theirs; everyone else sees
  // only their own requests.
  const canSeeBoard = abilities.isAdmin || abilities.leadOf.length > 0
  const scope = abilities.isAdmin ? null : abilities.leadOf

  const [mine, board] = await Promise.all([
    requestsFor(abilities.user.id, { limit }),
    canSeeBoard ? demandBoard(scope) : Promise.resolve({ modules: [], hasMore: false }),
  ])

  return { mine: mine.requests, hasMore: mine.hasMore, board, canSeeBoard }
})
