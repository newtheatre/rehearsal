/**
 * GET /api/v1/records?module=TECH-112&state=VALID — who currently holds X.
 *
 * The find-a-supervisor query, and the one that lets a consumer badge its own
 * UI ("valid supervisors in the building tonight"). Expired holders are
 * included by default only if asked for: held-but-expired is visible, never
 * hidden, but the useful default is the people who actually count.
 */

import { db, schema } from '@nuxthub/db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireServiceToken, setConsumerCacheHeaders } from '../../utils/serviceToken'
import { holdersOf } from '../../utils/records'
import { getConfigNumber } from '../../utils/siteConfig'
import { moduleIdSchema } from '../../utils/validation'

const querySchema = z.object({
  module: moduleIdSchema,
  state: z.enum(['VALID', 'EXPIRING', 'EXPIRED', 'all']).optional(),
})

export default defineEventHandler(async (event) => {
  await requireServiceToken(event)
  const { module: moduleId, state } = await getValidatedQuery(event, querySchema.parse)

  const module = await db.select({ id: schema.modules.id }).from(schema.modules)
    .where(eq(schema.modules.id, moduleId)).get()
  if (!module) {
    throw createError({ statusCode: 404, statusMessage: 'Unknown module' })
  }

  setConsumerCacheHeaders(event)
  const warningWindowDays = await getConfigNumber('warning_window_days')
  const holders = await holdersOf(moduleId, { warningWindowDays })

  const matches = holders.filter((holder) => {
    if (state === 'all') return true
    if (state) return holder.state === state
    // Default: the people who currently count, which is VALID plus EXPIRING.
    return holder.state !== 'EXPIRED'
  })

  return {
    module: moduleId,
    users: matches
      .map(holder => ({
        id: holder.userId,
        name: holder.name,
        state: holder.state,
        expiresAt: holder.expiresAt,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }
})
