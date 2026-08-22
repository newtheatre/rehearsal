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

  const [records, attended, delivered, requests] = await Promise.all([
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

    // Every row about this person, attendance and sign-ups alike. Being
    // marked absent is a fact recorded about them, so it is in the bundle.
    db.select({
      sessionId: schema.sessions.id,
      heldOn: schema.sessions.heldOn,
      location: schema.sessions.location,
      status: schema.sessionAttendees.status,
      signedUpAt: schema.sessionAttendees.signedUpAt,
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

    db.select({
      moduleId: schema.moduleRequests.moduleId,
      note: schema.moduleRequests.note,
      status: schema.moduleRequests.status,
      declineReason: schema.moduleRequests.declineReason,
      createdAt: schema.moduleRequests.createdAt,
    })
      .from(schema.moduleRequests)
      .where(eq(schema.moduleRequests.userId, userId))
      .orderBy(desc(schema.moduleRequests.createdAt))
      .all(),
  ])

  return {
    mirrored: true,
    account: { id: user.id, email: user.email, name: user.name },
    trainingRecords: records,
    // Kept to its own meaning: a sign-up they did not turn up to is not
    // attendance, and sessionSignups is where that lives.
    sessionsAttended: attended.filter(row => row.status === 'ATTENDED'),
    sessionSignups: attended,
    sessionsDelivered: delivered,
    moduleRequests: requests,
  }
})
