/**
 * POST /api/_hooks/auth/export: this app's contribution to a subject-access
 * bundle (stage-door docs/gdpr-retention.md).
 */

import { db, schema } from '@nuxthub/db'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireHookAuth } from '../../../utils/hookAuth'

const bodySchema = z.object({ userId: z.string().min(1) })

export default defineEventHandler(async (event) => {
  requireHookAuth(event)
  const { userId } = await readValidatedBody(event, bodySchema.parse)

  const user = await db.select().from(schema.users)
    .where(eq(schema.users.id, userId)).get()

  if (!user) {
    // Someone who never used the training system.
    return { mirrored: false }
  }

  const [records, attended, delivered] = await Promise.all([
    db.select({
      module: schema.records.moduleId,
      moduleName: schema.modules.name,
      awardedAt: schema.records.awardedAt,
      expiresAt: schema.records.expiresAt,
      source: schema.records.source,
      externalRef: schema.records.externalRef,
      revokedAt: schema.records.revokedAt,
      revokeReason: schema.records.revokeReason,
      createdAt: schema.records.createdAt,
    })
      .from(schema.records)
      .innerJoin(schema.modules, eq(schema.records.moduleId, schema.modules.id))
      .where(eq(schema.records.userId, userId))
      .orderBy(desc(schema.records.awardedAt))
      .all(),

    db.select({
      sessionId: schema.sessions.id,
      heldOn: schema.sessions.heldOn,
      location: schema.sessions.location,
    })
      .from(schema.sessionAttendees)
      .innerJoin(schema.sessions, eq(schema.sessionAttendees.sessionId, schema.sessions.id))
      .where(eq(schema.sessionAttendees.userId, userId))
      .orderBy(desc(schema.sessions.heldOn))
      .all(),

    db.select({
      sessionId: schema.sessions.id,
      heldOn: schema.sessions.heldOn,
      location: schema.sessions.location,
      notes: schema.sessions.notes,
    })
      .from(schema.sessions)
      .where(eq(schema.sessions.trainerUserId, userId))
      .orderBy(desc(schema.sessions.heldOn))
      .all(),
  ])

  return {
    mirrored: true,
    account: { id: user.id, email: user.email, name: user.name },
    trainingRecords: records,
    sessionsAttended: attended,
    sessionsDelivered: delivered,
  }
})
