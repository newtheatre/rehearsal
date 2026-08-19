/** GET /api/sessions: the delivery log, newest first. Any member may read it. */

import { z } from 'zod'
import { listSessions } from '../../utils/sessions'
import { useAbilities } from '../../utils/abilities'
import { isoDateSchema } from '../../utils/validation'

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  /** Both taken from the last row of the previous page. */
  beforeHeldOn: isoDateSchema.optional(),
  beforeId: z.string().trim().max(64).optional(),
})

export default defineEventHandler(async (event) => {
  await useAbilities(event)
  const { limit, beforeHeldOn, beforeId } = await getValidatedQuery(event, querySchema.parse)

  return listSessions({
    limit,
    before: beforeHeldOn && beforeId ? { heldOn: beforeHeldOn, id: beforeId } : undefined,
  })
})
