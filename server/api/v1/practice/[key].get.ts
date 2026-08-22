/**
 * GET /api/v1/practice/:key: is this person being taught this, right now?
 */

import { db, schema } from '@nuxthub/db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireServiceToken } from '../../../utils/serviceToken'
import { hasOpenWindow, loadTarget } from '../../../utils/practice'

const querySchema = z.object({
  userId: z.string().trim().min(1).max(64),
})

export default defineEventHandler(async (event) => {
  await requireServiceToken(event)
  const key = getRouterParam(event, 'key')
  const { userId } = await getValidatedQuery(event, querySchema.parse)

  const target = key ? await loadTarget(key) : null
  if (!target || target.status !== 'ACTIVE') {
    throw createError({
      statusCode: 404,
      statusMessage: `No active practice target named "${key}"`,
    })
  }

  // Never cached, unlike eligibility: a window a lead has just closed has to
  // stop answering true at once, or the sandbox outlives the lesson (ADR-0014).
  setHeader(event, 'Cache-Control', 'no-store')

  const user = await db.select({ id: schema.users.id }).from(schema.users)
    .where(eq(schema.users.id, userId)).get()
  if (!user) {
    throw createError({ statusCode: 404, statusMessage: 'Unknown user' })
  }

  const window = await hasOpenWindow(user.id, target.key)

  return {
    key: target.key,
    userId: user.id,
    active: Boolean(window),
    expiresAt: window?.expiresAt?.toISOString() ?? null,
    sessionId: window?.sessionId ?? null,
  }
})
