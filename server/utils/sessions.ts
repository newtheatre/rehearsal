/**
 * A session is the evidence; the records are the consequence. Written
 * together in one db.batch() so neither can land without the other.
 */

import { db, schema } from '@nuxthub/db'
import { and, desc, eq, inArray, lt, ne, or, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { buildRecordInserts, loadModules } from './records'
import type { ModuleRow } from './modules'
import { checkPrerequisitesForCohort, type PrerequisiteGap } from './prerequisites'
import { runAtomic } from './batch'
import { closeSessionWindowStatements } from './practice'

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

export interface RegisterMark {
  userId: string
  present: boolean
}

/**
 * Marking the register is what awards (ADR-0013). One batch: the marks, the
 * status, and a record for everybody present and nobody else.
 */
export async function deliverSession(options: {
  session: SessionRow
  modules: ModuleRow[]
  marks: RegisterMark[]
  actorUserId: string
  academicYearEnd?: string
}): Promise<{ sessionId: string, recordCount: number, present: string[], absent: string[] }> {
  const { session, modules } = options

  const present = options.marks.filter(mark => mark.present).map(mark => mark.userId)
  const absent = options.marks.filter(mark => !mark.present).map(mark => mark.userId)

  const records = buildRecordInserts({
    users: present,
    modules,
    awardedAt: session.heldOn,
    source: 'SESSION',
    sessionId: session.id,
    academicYearEnd: options.academicYearEnd,
  })

  const now = new Date()

  await runAtomic([
    db.update(schema.sessions).set({
      status: 'DELIVERED',
      deliveredAt: now,
      updatedAt: now,
    }).where(eq(schema.sessions.id, session.id)),

    ...options.marks.map(mark =>
      db.update(schema.sessionAttendees).set({
        status: mark.present ? 'ATTENDED' : 'ABSENT',
        markedAt: now,
        markedByUserId: options.actorUserId,
      }).where(and(
        eq(schema.sessionAttendees.sessionId, session.id),
        eq(schema.sessionAttendees.userId, mark.userId),
      )),
    ),

    // The lesson is over, so the sandbox closes with it.
    ...closeSessionWindowStatements(session.id, options.actorUserId, now),

    ...records.map(record => db.insert(schema.records).values(record)),
  ])

  return { sessionId: session.id, recordCount: records.length, present, absent }
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

  // Attendee rows carry the register's outcome, so they are amended in place.
  // Deleting and re-inserting would reset every mark to the ATTENDED default.
  const existingAttendees = await db.select().from(schema.sessionAttendees)
    .where(eq(schema.sessionAttendees.sessionId, sessionId)).all()
  const keep = new Set(input.attendeeIds)
  const already = new Map(existingAttendees.map(row => [row.userId, row]))

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

    ...input.moduleIds.map(moduleId =>
      db.insert(schema.sessionModules).values({ sessionId, moduleId }),
    ),

    // The edit asserts who attended, so everyone listed is marked present and
    // keeps the sign-up they already had.
    ...input.attendeeIds.map((userId) => {
      const row = already.get(userId)
      return row
        ? db.update(schema.sessionAttendees)
            .set({ status: 'ATTENDED', markedAt: now, markedByUserId: options.actorUserId })
            .where(eq(schema.sessionAttendees.id, row.id))
        : db.insert(schema.sessionAttendees).values({
            sessionId,
            userId,
            status: 'ATTENDED',
            markedAt: now,
            markedByUserId: options.actorUserId,
          })
    }),

    // An absence is the record of a no-show and survives the edit; anyone else
    // dropped from the list simply goes.
    ...existingAttendees
      .filter(row => !keep.has(row.userId) && row.status !== 'ABSENT')
      .map(row => db.delete(schema.sessionAttendees)
        .where(eq(schema.sessionAttendees.id, row.id))),

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

/**
 * Delivered sessions newest first: the log is what was taught, so a scheduled
 * one is not in it until its register is submitted (ADR-0013).
 */
export async function listSessions(
  { limit = 50, before }: { limit?: number, before?: { heldOn: string, id: string } } = {},
) {
  // Keyset on (held_on, id): held_on is a date, so many sessions share one.
  const cursor = before
    ? or(
        lt(schema.sessions.heldOn, before.heldOn),
        and(eq(schema.sessions.heldOn, before.heldOn), lt(schema.sessions.id, before.id)),
      )
    : undefined

  const rows = await db.select({
    session: schema.sessions,
    trainerName: schema.users.name,
  })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.sessions.trainerUserId, schema.users.id))
    .where(and(eq(schema.sessions.status, 'DELIVERED'), cursor))
    .orderBy(desc(schema.sessions.heldOn), desc(schema.sessions.id))
    // One extra row says whether there is another page without counting.
    .limit(limit + 1)
    .all()

  const sessions = rows.slice(0, limit)
  const hasMore = rows.length > limit

  if (sessions.length === 0) return { sessions: [], hasMore: false }

  const ids = sessions.map(s => s.session.id)
  const [modules, attendees] = await Promise.all([
    db.select().from(schema.sessionModules)
      .where(inArray(schema.sessionModules.sessionId, ids)).all(),
    db.select().from(schema.sessionAttendees)
      .where(inArray(schema.sessionAttendees.sessionId, ids)).all(),
  ])

  return {
    sessions: sessions.map(({ session, trainerName }) => ({
      ...session,
      trainerName,
      moduleIds: modules.filter(m => m.sessionId === session.id).map(m => m.moduleId),
      // Present, not signed up: an absentee got no record and did not attend.
      attendeeCount: attendees.filter(a => a.sessionId === session.id && a.status === 'ATTENDED').length,
    })),
    hasMore,
  }
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
    db.select({
      id: schema.users.id,
      name: schema.users.name,
      status: schema.sessionAttendees.status,
      signedUpAt: schema.sessionAttendees.signedUpAt,
      attendeeId: schema.sessionAttendees.id,
    })
      .from(schema.sessionAttendees)
      .innerJoin(schema.users, eq(schema.sessionAttendees.userId, schema.users.id))
      .where(and(
        eq(schema.sessionAttendees.sessionId, sessionId),
        ne(schema.sessionAttendees.status, 'CANCELLED'),
      )).all(),
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
