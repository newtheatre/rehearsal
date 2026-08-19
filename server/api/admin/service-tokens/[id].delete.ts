/**
 * DELETE /api/admin/service-tokens/:id: revoke a token.
 */

import { db, schema } from '@nuxthub/db'
import { eq } from 'drizzle-orm'
import { requirePermission } from '../../../utils/auth'
import { writeAudit } from '../../../utils/audit'

export default defineEventHandler(async (event) => {
  const admin = await requirePermission(event, 'config.manage')
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
