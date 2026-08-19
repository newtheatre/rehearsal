/**
 * GET /api/v1/eligibility/:key — everyone eligible, or with `?userId=`,
 * whether one person is.
 */

import { db, schema } from '@nuxthub/db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireServiceToken, setConsumerCacheHeaders } from '../../../utils/serviceToken'
import { eligibleUserIds, evaluateRule, loadRule, parseRequires, UnreadableRuleError } from '../../../utils/eligibility'
import { getConfigNumber } from '../../../utils/siteConfig'

const querySchema = z.object({
  userId: z.string().trim().min(1).max(64).optional(),
})

export default defineEventHandler(async (event) => {
  await requireServiceToken(event)
  const key = getRouterParam(event, 'key')
  const { userId } = await getValidatedQuery(event, querySchema.parse)

  const rule = key ? await loadRule(key) : null
  if (!rule) {
    throw createError({
      statusCode: 404,
      statusMessage: `No eligibility rule named "${key}"`,
    })
  }

  setConsumerCacheHeaders(event)

  // A rule we cannot read must not become "everyone qualifies": the consumer
  // is authorising on this (ADR-0010).
  let requires
  try {
    requires = parseRequires(rule.requires)
  }
  catch (error) {
    if (!(error instanceof UnreadableRuleError)) throw error
    throw createError({
      statusCode: 503,
      statusMessage: `Eligibility rule "${rule.key}" cannot be answered: ${error.message}`,
    })
  }

  const warningWindowDays = await getConfigNumber('warning_window_days')

  if (!userId) {
    return { key: rule.key, userIds: await eligibleUserIds(requires, { warningWindowDays }) }
  }

  const user = await db.select({ id: schema.users.id }).from(schema.users)
    .where(eq(schema.users.id, userId)).get()
  if (!user) {
    throw createError({ statusCode: 404, statusMessage: 'Unknown user' })
  }

  const answer = await evaluateRule(requires, user.id, { warningWindowDays })
  return { key: rule.key, userId: user.id, ...answer }
})
