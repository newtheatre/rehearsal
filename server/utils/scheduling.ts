/**
 * The session lifecycle before delivery: scheduling, sign-ups and places.
 * Nothing here writes a record. docs/scheduling-design.md
 */

import { db, schema } from '@nuxthub/db'
import { and, asc, eq, gte, inArray, ne, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { runAtomic, type BatchStatement } from './batch'
import { today } from '../../shared/utils/dates'
import type { SessionRow } from './sessions'
import { closeSessionWindowStatements } from './practice'

export type AttendeeRow = typeof schema.sessionAttendees.$inferSelect

/** The statuses a member may still join or leave. */
const LIVE_STATUSES = ['OPEN', 'FULL'] as const

export interface ScheduleInput {
  heldOn: string
  moduleIds: string[]
  startsAt?: Date | null
  endsAt?: Date | null
  signupsCloseAt?: Date | null
  capacity?: number | null
  location?: string | null
  description?: string | null
  notes?: string | null
}

/**
 * Who holds a place and who is behind them, from sign-up order alone. The
 * single implementation of "am I in" (docs/scheduling-design.md §3.3).
 */
export function splitByCapacity<T extends { signedUpAt: Date | null, id: string }>(
  signups: T[],
  capacity: number | null,
): { confirmed: T[], waitlisted: T[] } {
  const ordered = [...signups].sort(compareSignupOrder)
  if (capacity === null) return { confirmed: ordered, waitlisted: [] }
  return { confirmed: ordered.slice(0, capacity), waitlisted: ordered.slice(capacity) }
}

/** Ties break on id so the order is total, not merely stable in one engine. */
function compareSignupOrder(a: { signedUpAt: Date | null, id: string }, b: { signedUpAt: Date | null, id: string }): number {
  const at = a.signedUpAt?.getTime() ?? 0
  const bt = b.signedUpAt?.getTime() ?? 0
  return at - bt || a.id.localeCompare(b.id)
}

/** The module ids a session teaches. */
export async function moduleIdsFor(sessionId: string): Promise<string[]> {
  const rows = await db.select({ moduleId: schema.sessionModules.moduleId })
    .from(schema.sessionModules)
    .where(eq(schema.sessionModules.sessionId, sessionId))
    .all()
  return rows.map(row => row.moduleId)
}

/** Live sign-ups for a session, in the order that decides places. */
export async function signupsFor(sessionId: string): Promise<AttendeeRow[]> {
  const rows = await db.select().from(schema.sessionAttendees)
    .where(and(
      eq(schema.sessionAttendees.sessionId, sessionId),
      eq(schema.sessionAttendees.status, 'SIGNED_UP'),
    ))
    .all()
  return rows.sort(compareSignupOrder)
}

/**
 * FULL is a badge for the schedule list, recomputed on every write. Nothing
 * authoritative reads it: a sign-up decides on the live count (§3.3).
 */
function badgeStatement(session: SessionRow, signupCount: number): BatchStatement | null {
  if (!LIVE_STATUSES.includes(session.status as typeof LIVE_STATUSES[number])) return null

  const badge = session.capacity !== null && signupCount >= session.capacity ? 'FULL' : 'OPEN'
  if (badge === session.status) return null

  return db.update(schema.sessions).set({ status: badge, updatedAt: new Date() })
    .where(eq(schema.sessions.id, session.id))
}

export async function loadSessionRow(sessionId: string): Promise<SessionRow | undefined> {
  return db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).get()
}

/** Create a session that has not happened yet. Writes no records (ADR-0013). */
export async function scheduleSession(options: {
  input: ScheduleInput
  trainerUserId: string
  createdBy: string
  openNow: boolean
}): Promise<{ sessionId: string }> {
  const { input } = options
  const sessionId = nanoid()

  await runAtomic([
    db.insert(schema.sessions).values({
      id: sessionId,
      heldOn: input.heldOn,
      trainerUserId: options.trainerUserId,
      createdBy: options.createdBy,
      status: options.openNow ? 'OPEN' : 'PLANNED',
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
      signupsCloseAt: input.signupsCloseAt ?? null,
      capacity: input.capacity ?? null,
      location: input.location ?? null,
      description: input.description ?? null,
      notes: input.notes ?? null,
    }),
    ...input.moduleIds.map(moduleId =>
      db.insert(schema.sessionModules).values({ sessionId, moduleId }),
    ),
  ])

  return { sessionId }
}

/** Amend a session that has not been delivered. Modules are replaced wholesale. */
export async function updateSchedule(options: {
  sessionId: string
  input: Partial<ScheduleInput>
}): Promise<void> {
  const { sessionId, input } = options
  const statements: BatchStatement[] = []

  const fields: Partial<typeof schema.sessions.$inferInsert> = { updatedAt: new Date() }
  if (input.heldOn !== undefined) fields.heldOn = input.heldOn
  if (input.startsAt !== undefined) fields.startsAt = input.startsAt
  if (input.endsAt !== undefined) fields.endsAt = input.endsAt
  if (input.signupsCloseAt !== undefined) fields.signupsCloseAt = input.signupsCloseAt
  if (input.capacity !== undefined) fields.capacity = input.capacity
  if (input.location !== undefined) fields.location = input.location
  if (input.description !== undefined) fields.description = input.description
  if (input.notes !== undefined) fields.notes = input.notes

  statements.push(db.update(schema.sessions).set(fields).where(eq(schema.sessions.id, sessionId)))

  if (input.moduleIds) {
    statements.push(db.delete(schema.sessionModules).where(eq(schema.sessionModules.sessionId, sessionId)))
    statements.push(...input.moduleIds.map(moduleId =>
      db.insert(schema.sessionModules).values({ sessionId, moduleId }),
    ))
  }

  await runAtomic(statements)
}

/** Put a planned session in front of members. */
export async function openSignups(sessionId: string): Promise<void> {
  await db.update(schema.sessions)
    .set({ status: 'OPEN', updatedAt: new Date() })
    .where(eq(schema.sessions.id, sessionId))
}

/**
 * Cancel, and return who was signed up so the caller can tell them. No
 * records exist to touch: a cancelled session never delivered anything.
 */
export async function cancelSession(options: {
  sessionId: string
  reason: string
  actorUserId: string
}): Promise<{ notify: AttendeeRow[] }> {
  const signups = await signupsFor(options.sessionId)
  const now = new Date()

  await runAtomic([
    db.update(schema.sessions).set({
      status: 'CANCELLED',
      cancelledAt: now,
      cancelReason: options.reason,
      updatedAt: now,
    }).where(eq(schema.sessions.id, options.sessionId)),
    ...signups.map(row =>
      db.update(schema.sessionAttendees).set({ status: 'CANCELLED' })
        .where(eq(schema.sessionAttendees.id, row.id)),
    ),
    ...closeSessionWindowStatements(options.sessionId, options.actorUserId, now),
  ])

  return { notify: signups }
}

export class SignupError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message)
  }
}

/** Whether sign-ups are open at all, as a reason rather than a boolean. */
export function signupBlockedReason(session: SessionRow, now: Date = new Date()): string | null {
  if (session.status === 'CANCELLED') return 'That session was cancelled'
  if (session.status === 'DELIVERED') return 'That session has already been taught'
  if (session.status === 'PLANNED') return 'Sign-ups for that session are not open yet'
  if (session.registerOpenedAt) return 'The register for that session is already open'
  if (session.signupsCloseAt && now > session.signupsCloseAt) return 'Sign-ups for that session have closed'
  if (session.heldOn < today(now)) return 'That session is in the past'
  return null
}

export interface SignupResult {
  /** False when they are behind the capacity line (§3.3). */
  hasPlace: boolean
  /** 1-based position on the waitlist, or null when they hold a place. */
  waitlistPosition: number | null
}

/**
 * Sign up, or join the waitlist. Never refuses for being full: the place is
 * derived afterwards, which is what makes a simultaneous sign-up safe.
 */
export async function signUp(options: {
  session: SessionRow
  userId: string
  source: 'SELF' | 'LEAD'
}): Promise<SignupResult> {
  const { session, userId } = options
  const now = new Date()

  const existing = await db.select().from(schema.sessionAttendees)
    .where(and(
      eq(schema.sessionAttendees.sessionId, session.id),
      eq(schema.sessionAttendees.userId, userId),
    ))
    .get()

  if (existing?.status === 'SIGNED_UP') {
    throw new SignupError(409, 'Already signed up to that session')
  }

  const statements: BatchStatement[] = []
  if (existing) {
    // Re-joining keeps the row but takes a fresh place at the back: the
    // original sign-up time is not theirs to keep after withdrawing.
    statements.push(
      db.update(schema.sessionAttendees)
        .set({ status: 'SIGNED_UP', signedUpAt: now, source: options.source })
        .where(eq(schema.sessionAttendees.id, existing.id)),
    )
  }
  else {
    statements.push(
      db.insert(schema.sessionAttendees).values({
        sessionId: session.id,
        userId,
        status: 'SIGNED_UP',
        signedUpAt: now,
        source: options.source,
      }),
    )
  }

  await runAtomic(statements)

  const signups = await signupsFor(session.id)
  const badge = badgeStatement(session, signups.length)
  if (badge) await runAtomic([badge])

  const { confirmed, waitlisted } = splitByCapacity(signups, session.capacity)
  const place = confirmed.findIndex(row => row.userId === userId)
  if (place !== -1) return { hasPlace: true, waitlistPosition: null }

  return { hasPlace: false, waitlistPosition: waitlisted.findIndex(row => row.userId === userId) + 1 }
}

/**
 * Withdraw, and report who moved into a place because of it. Promotion is
 * arithmetic on sign-up order, so there is no status to half-update (§3.3).
 */
export async function withdraw(options: {
  session: SessionRow
  userId: string
}): Promise<{ promoted: AttendeeRow[] }> {
  const { session, userId } = options

  const before = await signupsFor(session.id)
  const row = before.find(item => item.userId === userId)
  if (!row) throw new SignupError(404, 'Not signed up to that session')

  const heldBefore = new Set(splitByCapacity(before, session.capacity).confirmed.map(item => item.id))

  await runAtomic([
    db.update(schema.sessionAttendees).set({ status: 'CANCELLED' })
      .where(eq(schema.sessionAttendees.id, row.id)),
  ])

  const after = before.filter(item => item.id !== row.id)
  const badge = badgeStatement(session, after.length)
  if (badge) await runAtomic([badge])

  const heldAfter = splitByCapacity(after, session.capacity).confirmed
  return { promoted: heldAfter.filter(item => !heldBefore.has(item.id)) }
}

/** Stamp the register open. What that unlocks is stage 4's business. */
export async function openRegister(sessionId: string): Promise<void> {
  await db.update(schema.sessions)
    .set({ registerOpenedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.sessions.id, sessionId))
}

export interface RegisterEntry {
  userId: string
  name: string
  hasPlace: boolean
  status: AttendeeRow['status']
}

/** The register, in sign-up order, with the waitlist marked but present. */
export async function registerFor(session: SessionRow): Promise<RegisterEntry[]> {
  const rows = await db.select({
    id: schema.sessionAttendees.id,
    userId: schema.sessionAttendees.userId,
    status: schema.sessionAttendees.status,
    signedUpAt: schema.sessionAttendees.signedUpAt,
    name: schema.users.name,
  })
    .from(schema.sessionAttendees)
    .innerJoin(schema.users, eq(schema.sessionAttendees.userId, schema.users.id))
    .where(and(
      eq(schema.sessionAttendees.sessionId, session.id),
      ne(schema.sessionAttendees.status, 'CANCELLED'),
    ))
    .all()

  const live = rows.filter(row => row.status === 'SIGNED_UP')
  const held = new Set(splitByCapacity(live, session.capacity).confirmed.map(row => row.id))

  return rows
    .sort(compareSignupOrder)
    .map(row => ({
      userId: row.userId,
      name: row.name,
      // Somebody already marked kept their place by turning up.
      hasPlace: row.status === 'SIGNED_UP' ? held.has(row.id) : true,
      status: row.status,
    }))
}

/** Add somebody who turned up unannounced. Places are derived, so no shuffling. */
export async function addAttendee(options: {
  session: SessionRow
  userId: string
}): Promise<void> {
  const existing = await db.select({ id: schema.sessionAttendees.id, status: schema.sessionAttendees.status })
    .from(schema.sessionAttendees)
    .where(and(
      eq(schema.sessionAttendees.sessionId, options.session.id),
      eq(schema.sessionAttendees.userId, options.userId),
    ))
    .get()

  if (existing?.status === 'SIGNED_UP') {
    throw new SignupError(409, 'They are already on this register')
  }

  const now = new Date()
  if (existing) {
    await runAtomic([
      db.update(schema.sessionAttendees)
        .set({ status: 'SIGNED_UP', signedUpAt: now, source: 'LEAD' })
        .where(eq(schema.sessionAttendees.id, existing.id)),
    ])
    return
  }

  await runAtomic([
    db.insert(schema.sessionAttendees).values({
      sessionId: options.session.id,
      userId: options.userId,
      status: 'SIGNED_UP',
      signedUpAt: now,
      source: 'LEAD',
    }),
  ])
}

export interface UpcomingSession {
  id: string
  heldOn: string
  startsAt: Date | null
  endsAt: Date | null
  status: SessionRow['status']
  location: string | null
  capacity: number | null
  trainerName: string
  moduleIds: string[]
  signupCount: number
  /** Places left, or null when the session is uncapped. */
  placesLeft: number | null
}

/**
 * Sessions still to come, soonest first. Members see OPEN and FULL only;
 * a trainer or lead also sees what is still PLANNED.
 */
export async function listUpcoming(
  { includePlanned = false, limit = 100 }: { includePlanned?: boolean, limit?: number } = {},
): Promise<UpcomingSession[]> {
  const visible = includePlanned
    ? ['PLANNED', 'OPEN', 'FULL'] as const
    : ['OPEN', 'FULL'] as const

  const rows = await db.select({
    session: schema.sessions,
    trainerName: schema.users.name,
  })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.sessions.trainerUserId, schema.users.id))
    .where(and(
      inArray(schema.sessions.status, [...visible]),
      gte(schema.sessions.heldOn, today()),
    ))
    .orderBy(asc(schema.sessions.heldOn), asc(schema.sessions.startsAt))
    .limit(limit)
    .all()

  if (rows.length === 0) return []

  const ids = rows.map(row => row.session.id)
  // Scoped by the same status predicate rather than by the ids just returned,
  // so neither statement's parameter count tracks the rows (ADR-0006 estate).
  const [modules, signups] = await Promise.all([
    db.select().from(schema.sessionModules)
      .where(inArray(schema.sessionModules.sessionId, ids)).all(),
    db.select({
      sessionId: schema.sessionAttendees.sessionId,
      count: sql<number>`count(*)`.as('count'),
    })
      .from(schema.sessionAttendees)
      .where(and(
        inArray(schema.sessionAttendees.sessionId, ids),
        eq(schema.sessionAttendees.status, 'SIGNED_UP'),
      ))
      .groupBy(schema.sessionAttendees.sessionId)
      .all(),
  ])

  const counts = new Map(signups.map(row => [row.sessionId, Number(row.count)]))

  return rows.map(({ session, trainerName }) => {
    const signupCount = counts.get(session.id) ?? 0
    return {
      id: session.id,
      heldOn: session.heldOn,
      startsAt: session.startsAt,
      endsAt: session.endsAt,
      status: session.status,
      location: session.location,
      capacity: session.capacity,
      trainerName,
      moduleIds: modules.filter(row => row.sessionId === session.id).map(row => row.moduleId),
      signupCount,
      placesLeft: session.capacity === null ? null : Math.max(0, session.capacity - signupCount),
    }
  })
}

/** Sessions this person is signed up to, soonest first. */
export async function myUpcoming(userId: string): Promise<{ sessionId: string, status: AttendeeRow['status'] }[]> {
  const rows = await db.select({
    sessionId: schema.sessionAttendees.sessionId,
    status: schema.sessionAttendees.status,
  })
    .from(schema.sessionAttendees)
    .innerJoin(schema.sessions, eq(schema.sessionAttendees.sessionId, schema.sessions.id))
    .where(and(
      eq(schema.sessionAttendees.userId, userId),
      eq(schema.sessionAttendees.status, 'SIGNED_UP'),
      ne(schema.sessions.status, 'CANCELLED'),
      gte(schema.sessions.heldOn, today()),
    ))
    .orderBy(asc(schema.sessions.heldOn))
    .all()

  return rows
}
