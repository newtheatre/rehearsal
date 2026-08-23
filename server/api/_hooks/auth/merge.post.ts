/**
 * POST /api/_hooks/auth/merge: account merge, this app's share (stage-door
 * ADR-0015).
 */

import { db, schema } from '@nuxthub/db'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { requireHookAuth } from '../../../utils/hookAuth'
import { writeAudit } from '../../../utils/audit'

const bodySchema = z.object({
  fromUserId: z.string().min(1),
  toUserId: z.string().min(1),
  dryRun: z.boolean().optional(),
})

export default defineEventHandler(async (event) => {
  requireHookAuth(event)
  const { fromUserId, toUserId, dryRun } = await readValidatedBody(event, bodySchema.parse)

  if (fromUserId === toUserId) {
    throw createError({ statusCode: 400, statusMessage: 'fromUserId and toUserId must differ' })
  }

  const loser = await db.select().from(schema.users)
    .where(eq(schema.users.id, fromUserId)).get()

  const count = async (table: string, column: string) => {
    const row = await db.get<{ n: number }>(
      sql`select count(*) as n from ${sql.raw(table)} where ${sql.raw(column)} = ${fromUserId}`,
    )
    return row?.n ?? 0
  }

  const counts = {
    records: await count('records', 'user_id'),
    recordsGranted: await count('records', 'granted_by'),
    recordsRevoked: await count('records', 'revoked_by'),
    sessionsDelivered: await count('sessions', 'trainer_user_id'),
    sessionsCreated: await count('sessions', 'created_by'),
    sessionAttendance: await count('session_attendees', 'user_id'),
    departmentLeads: await count('department_leads', 'user_id'),
    leadsGranted: await count('department_leads', 'granted_by'),
    rulesUpdated: await count('eligibility_rules', 'updated_by'),
    notifications: await count('notification_log', 'user_id'),
    moduleRequests: await count('module_requests', 'user_id'),
    requestsResolved: await count('module_requests', 'resolved_by'),
    registersMarked: await count('session_attendees', 'marked_by_user_id'),
    practiceWindows: await count('practice_windows', 'user_id'),
    practiceWindowsOpened: await count('practice_windows', 'opened_by'),
    practiceWindowsClosed: await count('practice_windows', 'closed_by'),
    practiceTargets: await count('practice_targets', 'updated_by'),
  }

  if (!loser || dryRun) {
    return { ok: true, notMirrored: !loser, counts }
  }

  // The winner needs a mirror row before anything points at it.
  await db.insert(schema.users)
    .values({
      id: toUserId,
      email: `merged-${toUserId}@placeholder.invalid`,
      name: loser.name,
    })
    .onConflictDoNothing()

  // ── Unique-index collisions, dropped before the re-point ────────────────

  // Scoped by subquery, not an id list: a winner's attendance history is
  // unbounded and would blow D1's bound-parameter cap (d1.ts).
  await db.delete(schema.sessionAttendees).where(and(
    eq(schema.sessionAttendees.userId, fromUserId),
    inArray(
      schema.sessionAttendees.sessionId,
      db.select({ sessionId: schema.sessionAttendees.sessionId })
        .from(schema.sessionAttendees)
        .where(eq(schema.sessionAttendees.userId, toUserId)),
    ),
  ))

  await db.delete(schema.moduleRequests).where(and(
    eq(schema.moduleRequests.userId, fromUserId),
    eq(schema.moduleRequests.status, 'OPEN'),
    inArray(
      schema.moduleRequests.moduleId,
      db.select({ moduleId: schema.moduleRequests.moduleId })
        .from(schema.moduleRequests)
        .where(and(
          eq(schema.moduleRequests.userId, toUserId),
          eq(schema.moduleRequests.status, 'OPEN'),
        )),
    ),
  ))

  await db.delete(schema.departmentLeads).where(and(
    eq(schema.departmentLeads.userId, fromUserId),
    inArray(
      schema.departmentLeads.department,
      db.select({ department: schema.departmentLeads.department })
        .from(schema.departmentLeads)
        .where(eq(schema.departmentLeads.userId, toUserId)),
    ),
  ))

  // ── Re-point everything ─────────────────────────────────────────────────

  await db.update(schema.records).set({ userId: toUserId })
    .where(eq(schema.records.userId, fromUserId))
  await db.update(schema.records).set({ grantedBy: toUserId })
    .where(eq(schema.records.grantedBy, fromUserId))
  await db.update(schema.records).set({ revokedBy: toUserId })
    .where(eq(schema.records.revokedBy, fromUserId))

  await db.update(schema.sessions).set({ trainerUserId: toUserId })
    .where(eq(schema.sessions.trainerUserId, fromUserId))
  await db.update(schema.sessions).set({ createdBy: toUserId })
    .where(eq(schema.sessions.createdBy, fromUserId))

  await db.update(schema.sessionAttendees).set({ userId: toUserId })
    .where(eq(schema.sessionAttendees.userId, fromUserId))

  await db.update(schema.departmentLeads).set({ userId: toUserId })
    .where(eq(schema.departmentLeads.userId, fromUserId))
  await db.update(schema.departmentLeads).set({ grantedBy: toUserId })
    .where(eq(schema.departmentLeads.grantedBy, fromUserId))

  await db.update(schema.eligibilityRules).set({ updatedBy: toUserId })
    .where(eq(schema.eligibilityRules.updatedBy, fromUserId))

  await db.update(schema.notificationLog).set({ userId: toUserId })
    .where(eq(schema.notificationLog.userId, fromUserId))

  await db.update(schema.sessionAttendees).set({ markedByUserId: toUserId })
    .where(eq(schema.sessionAttendees.markedByUserId, fromUserId))

  await db.update(schema.moduleRequests).set({ userId: toUserId })
    .where(eq(schema.moduleRequests.userId, fromUserId))
  await db.update(schema.moduleRequests).set({ resolvedBy: toUserId })
    .where(eq(schema.moduleRequests.resolvedBy, fromUserId))

  await db.update(schema.practiceWindows).set({ userId: toUserId })
    .where(eq(schema.practiceWindows.userId, fromUserId))
  await db.update(schema.practiceWindows).set({ openedBy: toUserId })
    .where(eq(schema.practiceWindows.openedBy, fromUserId))
  await db.update(schema.practiceWindows).set({ closedBy: toUserId })
    .where(eq(schema.practiceWindows.closedBy, fromUserId))

  await db.update(schema.practiceTargets).set({ updatedBy: toUserId })
    .where(eq(schema.practiceTargets.updatedBy, fromUserId))

  // Last: every column above must already point elsewhere or this throws.
  await db.delete(schema.users).where(eq(schema.users.id, fromUserId))

  await writeAudit({
    actorUserId: null, // the auth service is orchestrating
    action: 'user.merge',
    target: toUserId,
    detail: { fromUserId, toUserId, counts },
  })

  return { ok: true, notMirrored: false, counts }
})
