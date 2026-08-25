/** GET /api/admin/unmarked-sessions: registers that were never marked, oldest first. */

import { z } from 'zod'
import { requirePermission } from '../../utils/auth'
import { listUnmarkedSessions } from '../../utils/scheduling'
import { getConfigNumber } from '../../utils/siteConfig'
import { isoDateSchema } from '../../utils/validation'
import { today } from '../../../shared/utils/dates'

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  /** Both taken from the last row of the previous page. */
  afterHeldOn: isoDateSchema.optional(),
  afterId: z.string().trim().max(64).optional(),
})

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'config.manage')
  const { limit, afterHeldOn, afterId } = await getValidatedQuery(event, querySchema.parse)

  return listUnmarkedSessions({
    asOf: today(),
    staleAfterDays: await getConfigNumber('register_nag_stop_days'),
    limit,
    after: afterHeldOn && afterId ? { heldOn: afterHeldOn, id: afterId } : undefined,
  })
})
