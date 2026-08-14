/**
 * GET /api/v1/users/:id/records — one person's current training.
 */

import { db, schema } from '@nuxthub/db'
import { eq } from 'drizzle-orm'
import { requireServiceToken, setConsumerCacheHeaders } from '../../../../utils/serviceToken'
import { currentRecordsFor } from '../../../../utils/records'
import { getConfigNumber } from '../../../../utils/siteConfig'

export default defineEventHandler(async (event) => {
  await requireServiceToken(event)
  const userId = getRouterParam(event, 'id')

  const user = userId
    ? await db.select({ id: schema.users.id }).from(schema.users)
        .where(eq(schema.users.id, userId)).get()
    : undefined

  if (!user) {
    throw createError({ statusCode: 404, statusMessage: 'Unknown user' })
  }

  setConsumerCacheHeaders(event)
  const warningWindowDays = await getConfigNumber('warning_window_days')
  const records = await currentRecordsFor(user.id, { warningWindowDays })

  return {
    userId: user.id,
    records: records.map(record => record.kind === 'BRIEF'
      // A brief recurs per event and has no validity — reporting a state for
      // one would invite a consumer to gate on it (ADR-0003).
      ? {
          module: record.moduleId,
          kind: record.kind,
          awardedAt: record.awardedAt,
          lastAttended: record.awardedAt,
          source: record.source,
        }
      : {
          module: record.moduleId,
          kind: record.kind,
          awardedAt: record.awardedAt,
          expiresAt: record.expiresAt,
          state: record.state,
          source: record.source,
        }),
  }
})
