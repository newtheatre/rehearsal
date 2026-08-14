/**
 * GET /api/v1/eligibility/:key           → everyone currently eligible
 * GET /api/v1/eligibility/:key?userId=…  → is this one person eligible
 *
 * The endpoint the rota exists to call. This app answers; the consumer
 * enforces (ADR-0006) — we never learn what the rule is for, which is why
 * changing its contents is a committee decision made in the admin UI with no
 * deploy on either side.
 *
 * An unknown key is a loud 404 by design: it means a rule was renamed or
 * removed under a consumer, which is a configuration break, not a transient.
 */

import { db, schema } from '@nuxthub/db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireServiceToken, setConsumerCacheHeaders } from '../../../utils/serviceToken'
import { eligibleUserIds, evaluateRule, loadRule, parseRequires } from '../../../utils/eligibility'
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
  const requires = parseRequires(rule.requires)
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
