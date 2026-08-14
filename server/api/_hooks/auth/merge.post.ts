/**
 * POST /api/_hooks/auth/merge — account merge, this app's share (stage-door
 * ADR-0015). The winner absorbs the loser; `dryRun: true` returns the counts
 * without writing. Idempotent.
 *
 * **Missing a column is the classic bug here**, so all ten are listed rather
 * than discovered:
 *
 *   records.user_id · records.granted_by · records.revoked_by
 *   sessions.trainer_user_id · sessions.created_by
 *   session_attendees.user_id
 *   department_leads.user_id · department_leads.granted_by
 *   eligibility_rules.updated_by
 *   notification_log.user_id
 *
 * Two sit under unique indexes — `session_attendees(session_id, user_id)` and
 * `department_leads(department, user_id)` — so if both accounts attended the
 * same session or led the same department, a blind update violates the index
 * and the whole merge fails. Those rows are dropped rather than moved.
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
  }

  if (!loser || dryRun) {
    return { ok: true, notMirrored: !loser, counts }
  }

  // The winner needs a mirror row before anything points at it. A minimal
  // one is fine — ensureLocalUser overwrites it with the canonical identity
  // on the winner's next request.
  await db.insert(schema.users)
    .values({
      id: toUserId,
      email: `merged-${toUserId}@placeholder.invalid`,
      name: loser.name,
    })
    .onConflictDoNothing()

  // ── Unique-index collisions, dropped before the re-point ────────────────

  const sharedSessions = await db.select({ sessionId: schema.sessionAttendees.sessionId })
    .from(schema.sessionAttendees)
    .where(eq(schema.sessionAttendees.userId, toUserId)).all()

  if (sharedSessions.length > 0) {
    await db.delete(schema.sessionAttendees).where(and(
      eq(schema.sessionAttendees.userId, fromUserId),
      inArray(schema.sessionAttendees.sessionId, sharedSessions.map(s => s.sessionId)),
    ))
  }

  const sharedDepartments = await db.select({ department: schema.departmentLeads.department })
    .from(schema.departmentLeads)
    .where(eq(schema.departmentLeads.userId, toUserId)).all()

  if (sharedDepartments.length > 0) {
    await db.delete(schema.departmentLeads).where(and(
      eq(schema.departmentLeads.userId, fromUserId),
      inArray(schema.departmentLeads.department, sharedDepartments.map(d => d.department)),
    ))
  }

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

  await db.delete(schema.users).where(eq(schema.users.id, fromUserId))

  await writeAudit({
    actorUserId: null, // the auth service is orchestrating
    action: 'user.merge',
    target: toUserId,
    detail: { fromUserId, toUserId, counts },
  })

  return { ok: true, notMirrored: false, counts }
})
