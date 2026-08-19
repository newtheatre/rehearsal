/**
 * A session is the evidence; the records are the consequence. Written
 * together in one db.batch() so neither can land without the other.
 */

import { db, schema } from '@nuxthub/db'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { buildRecordInserts, loadModules } from './records'
import type { ModuleRow } from './modules'
import { checkPrerequisitesForCohort, type PrerequisiteGap } from './prerequisites'
import { runAtomic } from './batch'

export type SessionRow = typeof schema.sessions.$inferSelect

export interface SessionInput {
  heldOn: string
  moduleIds: string[]
  attendeeIds: string[]
  location?: string | null
  notes?: string | null
}

export interface AttendeeWarning {
  userId: string
  name: string
  moduleId: string
  missing: PrerequisiteGap[]
}

/**
 * Safety-critical modules produce a hard failure, everything else a warning.
 * Computed before the batch, because a batch cannot branch mid-flight.
 */
export async function checkSessionPrerequisites(
  modules: ModuleRow[],
  attendeeIds: string[],
  { warningWindowDays = 60 }: { warningWindowDays?: number } = {},
): Promise<{ warnings: AttendeeWarning[], blocking: AttendeeWarning[] }> {
  const users = attendeeIds.length
    ? await db.select({ id: schema.users.id, name: schema.users.name })
        .from(schema.users).where(inArray(schema.users.id, attendeeIds)).all()
    : []
  const names = new Map(users.map(u => [u.id, u.name]))

  const warnings: AttendeeWarning[] = []
  const blocking: AttendeeWarning[] = []

  const checks = await checkPrerequisitesForCohort(
    attendeeIds,
    modules.map(m => m.id),
    { warningWindowDays },
  )

  for (const module of modules) {
    for (const userId of attendeeIds) {
      const { met, missing } = checks.get(`${userId}:${module.id}`) ?? { met: true, missing: [] }
      if (met) continue

      const gap: AttendeeWarning = {
        userId,
        name: names.get(userId) ?? userId,
        moduleId: module.id,
        missing,
      }
      ;(module.safetyCritical ? blocking : warnings).push(gap)
    }
  }

  return { warnings, blocking }
}

/**
 * Create a session and its records atomically. `academicYearEnd` is threaded
 * through so stamping honours site config.
 */
export async function createSession(options: {
  input: SessionInput
  trainerUserId: string
  createdBy: string
  academicYearEnd?: string
}): Promise<{ sessionId: string, recordCount: number }> {
  const { input } = options
  const modules = await loadModules(input.moduleIds)

  const sessionId = nanoid()

  const records = buildRecordInserts({
    users: input.attendeeIds,
    modules,
    awardedAt: input.heldOn,
    source: 'SESSION',
    sessionId,
    academicYearEnd: options.academicYearEnd,
  })

  await runAtomic([
    db.insert(schema.sessions).values({
      id: sessionId,
      heldOn: input.heldOn,
      trainerUserId: options.trainerUserId,
      location: input.location ?? null,
      notes: input.notes ?? null,
      createdBy: options.createdBy,
    }),
    ...input.moduleIds.map(moduleId =>
      db.insert(schema.sessionModules).values({ sessionId, moduleId }),
    ),
    ...input.attendeeIds.map(userId =>
      db.insert(schema.sessionAttendees).values({ sessionId, userId }),
    ),
    ...records.map(record => db.insert(schema.records).values(record)),
  ])

  return { sessionId, recordCount: records.length }
}

/**
 * Records from the session are revoked, not deleted (ADR-0008), so removing
 * an attendee leaves a visible withdrawal rather than a gap.
 */
export async function applySessionEdit(options: {
  sessionId: string
  input: SessionInput
  actorUserId: string
  academicYearEnd?: string
}): Promise<{ revoked: number, created: number }> {
  const { input, sessionId } = options
  const modules = await loadModules(input.moduleIds)

  const existingRecords = await db.select().from(schema.records)
    .where(and(
      eq(schema.records.sessionId, sessionId),
      sql`${schema.records.revokedAt} is null`,
    )).all()

  const records = buildRecordInserts({
    users: input.attendeeIds,
    modules,
    awardedAt: input.heldOn,
    source: 'SESSION',
    sessionId,
    academicYearEnd: options.academicYearEnd,
  })

  const now = new Date()

  await runAtomic([
    db.update(schema.sessions).set({
      heldOn: input.heldOn,
      location: input.location ?? null,
      notes: input.notes ?? null,
      updatedAt: now,
    }).where(eq(schema.sessions.id, sessionId)),

    db.delete(schema.sessionModules).where(eq(schema.sessionModules.sessionId, sessionId)),
    db.delete(schema.sessionAttendees).where(eq(schema.sessionAttendees.sessionId, sessionId)),

    ...input.moduleIds.map(moduleId =>
      db.insert(schema.sessionModules).values({ sessionId, moduleId }),
    ),
    ...input.attendeeIds.map(userId =>
      db.insert(schema.sessionAttendees).values({ sessionId, userId }),
    ),

    // Supersede the old records rather than deleting them.
    ...existingRecords.map(record =>
      db.update(schema.records).set({
        revokedAt: now,
        revokedBy: options.actorUserId,
        revokeReason: 'Session edited',
      }).where(eq(schema.records.id, record.id)),
    ),

    ...records.map(record => db.insert(schema.records).values(record)),
  ])

  return { revoked: existingRecords.length, created: records.length }
}

/** Sessions newest first, with their modules and attendee counts. */
export async function listSessions({ limit = 50 }: { limit?: number } = {}) {
  const sessions = await db.select({
    session: schema.sessions,
    trainerName: schema.users.name,
  })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.sessions.trainerUserId, schema.users.id))
    .orderBy(desc(schema.sessions.heldOn), desc(schema.sessions.createdAt))
    .limit(limit)
    .all()

  if (sessions.length === 0) return []

  const ids = sessions.map(s => s.session.id)
  const [modules, attendees] = await Promise.all([
    db.select().from(schema.sessionModules)
      .where(inArray(schema.sessionModules.sessionId, ids)).all(),
    db.select().from(schema.sessionAttendees)
      .where(inArray(schema.sessionAttendees.sessionId, ids)).all(),
  ])

  return sessions.map(({ session, trainerName }) => ({
    ...session,
    trainerName,
    moduleIds: modules.filter(m => m.sessionId === session.id).map(m => m.moduleId),
    attendeeCount: attendees.filter(a => a.sessionId === session.id).length,
  }))
}

/** One session with everything needed to render or edit it. */
export async function getSessionDetail(sessionId: string) {
  const row = await db.select({
    session: schema.sessions,
    trainerName: schema.users.name,
  })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.sessions.trainerUserId, schema.users.id))
    .where(eq(schema.sessions.id, sessionId))
    .get()

  if (!row) return null

  const [modules, attendees, records] = await Promise.all([
    db.select({ id: schema.modules.id, name: schema.modules.name, kind: schema.modules.kind })
      .from(schema.sessionModules)
      .innerJoin(schema.modules, eq(schema.sessionModules.moduleId, schema.modules.id))
      .where(eq(schema.sessionModules.sessionId, sessionId)).all(),
    db.select({ id: schema.users.id, name: schema.users.name })
      .from(schema.sessionAttendees)
      .innerJoin(schema.users, eq(schema.sessionAttendees.userId, schema.users.id))
      .where(eq(schema.sessionAttendees.sessionId, sessionId)).all(),
    db.select().from(schema.records).where(eq(schema.records.sessionId, sessionId)).all(),
  ])

  return {
    ...row.session,
    trainerName: row.trainerName,
    modules,
    attendees,
    recordCount: records.filter(r => r.revokedAt === null).length,
  }
}

/** Whether this session is still inside its edit window. */
export function withinEditWindow(session: SessionRow, editWindowDays: number, now = new Date()): boolean {
  const age = now.getTime() - session.createdAt.getTime()
  return age <= editWindowDays * 24 * 60 * 60 * 1000
}
