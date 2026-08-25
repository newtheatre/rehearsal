/**
 * POST /api/_hooks/auth/merge: account merge, this app's share (stage-door
 * ADR-0015).
 */

import { db, schema } from '@nuxthub/db'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { requireHookAuth } from '../../../utils/hookAuth'
import { auditStatement } from '../../../utils/audit'
import { runAtomic, type BatchStatement } from '../../../utils/batch'

const bodySchema = z.object({
  fromUserId: z.string().min(1),
  toUserId: z.string().min(1),
  dryRun: z.boolean().optional(),
})

/**
 * Every column in this app that names a user. Adding one here is what makes a
 * merge move it and what makes the completeness check see it (ADR-0015).
 */
const USER_COLUMNS = [
  ['records', 'records', 'user_id'],
  ['recordsGranted', 'records', 'granted_by'],
  ['recordsRevoked', 'records', 'revoked_by'],
  ['sessionsDelivered', 'sessions', 'trainer_user_id'],
  ['sessionsCreated', 'sessions', 'created_by'],
  ['sessionAttendance', 'session_attendees', 'user_id'],
  ['registersMarked', 'session_attendees', 'marked_by_user_id'],
  ['departmentLeads', 'department_leads', 'user_id'],
  ['leadsGranted', 'department_leads', 'granted_by'],
  ['rulesUpdated', 'eligibility_rules', 'updated_by'],
  ['notifications', 'notification_log', 'user_id'],
  ['moduleRequests', 'module_requests', 'user_id'],
  ['requestsResolved', 'module_requests', 'resolved_by'],
  ['practiceWindows', 'practice_windows', 'user_id'],
  ['practiceWindowsOpened', 'practice_windows', 'opened_by'],
  ['practiceWindowsClosed', 'practice_windows', 'closed_by'],
  ['practiceTargets', 'practice_targets', 'updated_by'],
  ['auditActions', 'audit_log', 'actor_user_id'],
] as const

/** One statement, one bound id per column, so the count never tracks rows. */
async function countUserColumns(userId: string): Promise<Record<string, number>> {
  const parts = USER_COLUMNS.map(([key, table, column]) =>
    sql`(select count(*) from ${sql.raw(table)} where ${sql.raw(column)} = ${userId}) as ${sql.raw(key)}`)

  const row = await db.get<Record<string, number>>(sql`select ${sql.join(parts, sql`, `)}`)
  return Object.fromEntries(USER_COLUMNS.map(([key]) => [key, Number(row?.[key] ?? 0)]))
}

/** ATTENDED outranks ABSENT outranks a live sign-up outranks a withdrawal. */
function attendanceRank(table: string) {
  return sql.raw(`case ${table}.status when 'ATTENDED' then 3 when 'ABSENT' then 2 when 'SIGNED_UP' then 1 else 0 end`)
}

/**
 * Resolve a collision by outcome rather than by which account holds the row:
 * the register's evidence must survive the merge, not the newer account's.
 */
function attendanceCollisionStatements(fromUserId: string, toUserId: string): BatchStatement[] {
  return [
    // Whichever row survives carries the earlier sign-up, and a null sign-up
    // (logged rather than signed up) already sorts earliest (ADR-0013).
    db.run(sql`
      update session_attendees set signed_up_at = (
        select case when count(*) > count(pair.signed_up_at) then null else min(pair.signed_up_at) end
        from session_attendees pair
        where pair.session_id = session_attendees.session_id
          and pair.user_id in (${fromUserId}, ${toUserId}))
      where session_attendees.user_id in (${fromUserId}, ${toUserId})
        and (select count(*) from session_attendees pair
             where pair.session_id = session_attendees.session_id
               and pair.user_id in (${fromUserId}, ${toUserId})) = 2`),

    db.run(sql`
      delete from session_attendees
      where user_id = ${fromUserId}
        and exists (select 1 from session_attendees held
                    where held.user_id = ${toUserId}
                      and held.session_id = session_attendees.session_id
                      and ${attendanceRank('held')} >= ${attendanceRank('session_attendees')})`),

    db.run(sql`
      delete from session_attendees
      where user_id = ${toUserId}
        and exists (select 1 from session_attendees held
                    where held.user_id = ${fromUserId}
                      and held.session_id = session_attendees.session_id
                      and ${attendanceRank('held')} > ${attendanceRank('session_attendees')})`),
  ]
}

/** The earlier appointment survives, with the person who made it. */
function leadCollisionStatements(fromUserId: string, toUserId: string): BatchStatement[] {
  return [
    db.run(sql`
      delete from department_leads
      where user_id = ${fromUserId}
        and exists (select 1 from department_leads held
                    where held.user_id = ${toUserId}
                      and held.department = department_leads.department
                      and held.created_at <= department_leads.created_at)`),

    db.run(sql`
      delete from department_leads
      where user_id = ${toUserId}
        and exists (select 1 from department_leads held
                    where held.user_id = ${fromUserId}
                      and held.department = department_leads.department
                      and held.created_at < department_leads.created_at)`),
  ]
}

export default defineEventHandler(async (event) => {
  requireHookAuth(event)
  const { fromUserId, toUserId, dryRun } = await readValidatedBody(event, bodySchema.parse)

  if (fromUserId === toUserId) {
    throw createError({ statusCode: 400, statusMessage: 'fromUserId and toUserId must differ' })
  }

  const loser = await db.select().from(schema.users)
    .where(eq(schema.users.id, fromUserId)).get()

  // Read before the batch: the audit detail describes the pre-merge state.
  const counts = await countUserColumns(fromUserId)
  const outstanding = Object.values(counts).reduce((total, n) => total + n, 0)

  if (!loser || dryRun) {
    return { ok: true, notMirrored: !loser, alreadyMerged: false, counts }
  }

  // Tombstoned into this winner with nothing left pointing at it. A retry
  // after a half-done merge finishes it rather than short-circuiting.
  if (loser.mergedInto === toUserId && outstanding === 0) {
    return { ok: true, notMirrored: false, alreadyMerged: true, counts }
  }

  const now = new Date()

  await runAtomic([
    // The winner needs a mirror row before anything points at it.
    db.insert(schema.users)
      .values({
        id: toUserId,
        email: `merged-${toUserId}@placeholder.invalid`,
        name: loser.name,
      })
      .onConflictDoNothing(),

    // ── Unique-index collisions, resolved before the re-point ──────────────

    ...attendanceCollisionStatements(fromUserId, toUserId),
    ...leadCollisionStatements(fromUserId, toUserId),

    // An open request is a demand signal with no evidence on it, so the
    // winner's stands and the loser's goes.
    db.delete(schema.moduleRequests).where(and(
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
    )),

    // ── Re-point everything ───────────────────────────────────────────────

    db.update(schema.records).set({ userId: toUserId })
      .where(eq(schema.records.userId, fromUserId)),
    db.update(schema.records).set({ grantedBy: toUserId })
      .where(eq(schema.records.grantedBy, fromUserId)),
    db.update(schema.records).set({ revokedBy: toUserId })
      .where(eq(schema.records.revokedBy, fromUserId)),

    db.update(schema.sessions).set({ trainerUserId: toUserId })
      .where(eq(schema.sessions.trainerUserId, fromUserId)),
    db.update(schema.sessions).set({ createdBy: toUserId })
      .where(eq(schema.sessions.createdBy, fromUserId)),

    db.update(schema.sessionAttendees).set({ userId: toUserId })
      .where(eq(schema.sessionAttendees.userId, fromUserId)),
    db.update(schema.sessionAttendees).set({ markedByUserId: toUserId })
      .where(eq(schema.sessionAttendees.markedByUserId, fromUserId)),

    db.update(schema.departmentLeads).set({ userId: toUserId })
      .where(eq(schema.departmentLeads.userId, fromUserId)),
    db.update(schema.departmentLeads).set({ grantedBy: toUserId })
      .where(eq(schema.departmentLeads.grantedBy, fromUserId)),

    db.update(schema.eligibilityRules).set({ updatedBy: toUserId })
      .where(eq(schema.eligibilityRules.updatedBy, fromUserId)),

    db.update(schema.notificationLog).set({ userId: toUserId })
      .where(eq(schema.notificationLog.userId, fromUserId)),

    db.update(schema.moduleRequests).set({ userId: toUserId })
      .where(eq(schema.moduleRequests.userId, fromUserId)),
    db.update(schema.moduleRequests).set({ resolvedBy: toUserId })
      .where(eq(schema.moduleRequests.resolvedBy, fromUserId)),

    db.update(schema.practiceWindows).set({ userId: toUserId })
      .where(eq(schema.practiceWindows.userId, fromUserId)),
    db.update(schema.practiceWindows).set({ openedBy: toUserId })
      .where(eq(schema.practiceWindows.openedBy, fromUserId)),
    db.update(schema.practiceWindows).set({ closedBy: toUserId })
      .where(eq(schema.practiceWindows.closedBy, fromUserId)),

    db.update(schema.practiceTargets).set({ updatedBy: toUserId })
      .where(eq(schema.practiceTargets.updatedBy, fromUserId)),

    // The person's history moved, so their actions must move with it or the
    // trail reads "Deleted user" for everything they ever signed off.
    db.update(schema.auditLog).set({ actorUserId: toUserId })
      .where(eq(schema.auditLog.actorUserId, fromUserId)),

    // Last: tombstoned, never deleted. A cookie sealed before the merge would
    // otherwise re-insert the losing id on the next page load (ADR-0015).
    db.update(schema.users).set({
      email: `merged-${fromUserId}@placeholder.invalid`,
      name: 'Merged account',
      mergedInto: toUserId,
      updatedAt: now,
    }).where(eq(schema.users.id, fromUserId)),

    auditStatement({
      actorUserId: null, // the auth service is orchestrating
      action: 'user.merge',
      target: toUserId,
      detail: { fromUserId, toUserId, counts },
    }),
  ])

  // audit_log and notification_log have no foreign key, so no delete can catch
  // a missed re-point: the count is the check (ADR-0015).
  const left = await countUserColumns(fromUserId)
  const missed = Object.entries(left).filter(([, n]) => n > 0).map(([key]) => key)
  if (missed.length > 0) {
    throw createError({
      statusCode: 500,
      statusMessage: `The merge left rows behind: ${missed.join(', ')}`,
    })
  }

  return { ok: true, notMirrored: false, alreadyMerged: false, counts }
})
