/**
 * DELETE /api/admin/service-tokens/:id — revoke a token.
 *
 * The consumer starts getting 401s immediately, which is its tested failure
 * mode (docs/consuming-the-api.md#freshness). Unlike records, a token row is
 * genuinely deleted: it is a credential, not evidence.
 */

import { db, schema } from '@nuxthub/db'
import { eq } from 'drizzle-orm'
import { requireAdmin } from '../../../utils/auth'
import { writeAudit } from '../../../utils/audit'

export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const id = getRouterParam(event, 'id')

  const token = id
    ? await db.select().from(schema.serviceTokens).where(eq(schema.serviceTokens.id, id)).get()
    : undefined
  if (!token) {
    throw createError({ statusCode: 404, statusMessage: 'Token not found' })
  }

  await db.delete(schema.serviceTokens).where(eq(schema.serviceTokens.id, token.id))

  await writeAudit({
    actorUserId: admin.id,
    action: 'service-token.revoke',
    target: token.id,
    detail: { name: token.name, lastUsedAt: token.lastUsedAt },
  })

  return { id: token.id, name: token.name, revoked: true }
})
