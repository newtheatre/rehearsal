/**
 * POST /api/records/:id/revoke: withdraw a record.
 */

import { db, schema } from '@nuxthub/db'
import { eq } from 'drizzle-orm'
import { revokeSchema } from '../../../utils/validation'
import { requirePermission } from '../../../utils/auth'
import { writeAudit } from '../../../utils/audit'

export default defineEventHandler(async (event) => {
  const admin = await requirePermission(event, 'record.manage')
  const id = getRouterParam(event, 'id')
  const input = await readValidatedBody(event, revokeSchema.parse)

  const record = id
    ? await db.select().from(schema.records).where(eq(schema.records.id, id)).get()
    : undefined
  if (!record) {
    throw createError({ statusCode: 404, statusMessage: 'Record not found' })
  }

  if (record.revokedAt) {
    // Idempotent rather than an error: two admins reaching the same
    // conclusion at once shouldn't produce a failure.
    return { id: record.id, alreadyRevoked: true, revokedAt: record.revokedAt }
  }

  const revokedAt = new Date()

  await db.update(schema.records).set({
    revokedAt,
    revokedBy: admin.id,
    revokeReason: input.reason,
  }).where(eq(schema.records.id, record.id))

  await writeAudit({
    actorUserId: admin.id,
    action: 'record.revoke',
    target: record.id,
    detail: {
      userId: record.userId,
      moduleId: record.moduleId,
      awardedAt: record.awardedAt,
      source: record.source,
      reason: input.reason,
    },
  })

  return { id: record.id, revokedAt, moduleId: record.moduleId }
})
