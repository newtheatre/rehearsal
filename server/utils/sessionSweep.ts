/**
 * The daily session sweep: tomorrow's reminders, and nagging a lead whose
 * register is still unmarked. Neither creates or destroys a record.
 */

import { db, schema } from '@nuxthub/db'
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import { renderRegisterNag, renderSessionReminder, sendEmail } from './email'
import { addressableUsers, sessionEmailSummary, type Recipient } from './sessionNotify'
import { registerFor } from './scheduling'
import { sweepExpiredWindows } from './practice'
import { getConfig, getConfigNumber } from './siteConfig'
import { chunk } from './d1'
import { daysBetween, today } from '../../shared/utils/dates'
import { addDays } from './validity'

export type SessionNotificationType = 'session.reminder' | 'session.nag'

export interface SessionSweepResult {
  asOf: string
  mode: 'dry-run' | 'live'
  reminders: number
  nags: number
  /** Past the nag cutoff and still unmarked: nobody emails these any more. */
  stale: number
  windowsClosed: number
  failed: number
}

/** A nag repeats, but weekly rather than every morning. */
const NAG_INTERVAL_DAYS = 7

/** When each notification last went out, so a re-run sends nothing new. */
async function lastSent(sessionIds: string[]): Promise<Map<string, Date>> {
  if (sessionIds.length === 0) return new Map()

  // Chunked: the sweep's session set is unbounded, and one parameter per id
  // would blow D1's cap of 100 on a busy term (d1.ts).
  const rows = []
  for (const batch of chunk(sessionIds)) {
    rows.push(...await db.select({
      sessionId: schema.notificationLog.sessionId,
      userId: schema.notificationLog.userId,
      type: schema.notificationLog.type,
      sentAt: schema.notificationLog.sentAt,
    })
      .from(schema.notificationLog)
      .where(inArray(schema.notificationLog.sessionId, batch))
      .all())
  }

  const latest = new Map<string, Date>()
  for (const row of rows) {
    const key = `${row.sessionId}:${row.userId}:${row.type}`
    const seen = latest.get(key)
    if (!seen || row.sentAt > seen) latest.set(key, row.sentAt)
  }
  return latest
}

export async function runSessionSweep(asOf: string = today()): Promise<SessionSweepResult> {
  const [mode, reminderDays, nagDays, nagStopDays] = await Promise.all([
    getConfig('notifications_mode'),
    getConfigNumber('session_reminder_days'),
    getConfigNumber('register_nag_days'),
    getConfigNumber('register_nag_stop_days'),
  ])
  const live = mode === 'live'

  const reminderDay = addDays(asOf, reminderDays)
  // The nag phase is bounded: every session it covers costs per-session reads
  // and a weekly email to a lead who may have left (docs/operations.md).
  const nagFloor = addDays(asOf, -nagStopDays)

  const [dueReminders, unmarked, stale] = await Promise.all([
    db.select().from(schema.sessions)
      .where(and(
        eq(schema.sessions.heldOn, reminderDay),
        inArray(schema.sessions.status, ['OPEN', 'FULL']),
      ))
      .all(),
    // Past its day, still not marked, and not cancelled: nobody has a record.
    db.select().from(schema.sessions)
      .where(and(
        lt(schema.sessions.heldOn, asOf),
        gte(schema.sessions.heldOn, nagFloor),
        inArray(schema.sessions.status, ['OPEN', 'FULL']),
      ))
      .all(),
    // Counted, never read per session: the nag stops, the row must not vanish.
    db.select({ count: sql<number>`count(*)` }).from(schema.sessions)
      .where(and(
        lt(schema.sessions.heldOn, nagFloor),
        inArray(schema.sessions.status, ['OPEN', 'FULL']),
      ))
      .get(),
  ])

  const seen = await lastSent([...dueReminders, ...unmarked].map(session => session.id))

  let reminders = 0
  let nags = 0
  let failed = 0

  const deliver = async (
    recipient: Recipient,
    sessionId: string,
    type: SessionNotificationType,
    mail: { subject: string, html: string },
    repeatAfterDays = 0,
  ) => {
    const previous = seen.get(`${sessionId}:${recipient.id}:${type}`)
    if (previous) {
      if (repeatAfterDays === 0) return false
      const due = previous.getTime() + repeatAfterDays * 86_400_000
      if (Date.now() < due) return false
    }
    if (!live) return true

    try {
      await sendEmail({ to: recipient.email, subject: mail.subject, html: mail.html })
    }
    catch {
      failed++
      return false
    }

    await db.insert(schema.notificationLog).values({
      userId: recipient.id,
      type,
      sessionId,
    })
    return true
  }

  for (const session of dueReminders) {
    const summary = await sessionEmailSummary(session.id)
    if (!summary) continue

    const register = await registerFor(session)
    const stillComing = register.filter(entry => entry.status === 'SIGNED_UP')
    const recipients = await addressableUsers(stillComing.map(entry => entry.userId))
    const held = new Map(stillComing.map(entry => [entry.userId, entry.hasPlace]))

    for (const recipient of recipients) {
      const ok = await deliver(recipient, session.id, 'session.reminder', renderSessionReminder({
        name: recipient.name,
        session: summary,
        hasPlace: held.get(recipient.id) ?? false,
        daysAhead: daysBetween(asOf, session.heldOn),
      }))
      if (ok) reminders++
    }
  }

  for (const session of unmarked) {
    // The cheap gate first: most unmarked sessions are not yet due a nag, and
    // the reads below are per session.
    const daysAgo = daysBetween(session.heldOn, asOf)
    if (daysAgo < nagDays) continue

    const summary = await sessionEmailSummary(session.id)
    if (!summary) continue

    const register = await registerFor(session)
    const [lead] = await addressableUsers([session.trainerUserId])
    if (!lead) continue

    const ok = await deliver(lead, session.id, 'session.nag', renderRegisterNag({
      name: lead.name,
      session: summary,
      signupCount: register.filter(entry => entry.status === 'SIGNED_UP').length,
      daysAgo,
    }), NAG_INTERVAL_DAYS)
    if (ok) nags++
  }

  // Housekeeping, not a notification, so it runs whatever the mode.
  const windowsClosed = await sweepExpiredWindows()

  return {
    asOf,
    mode: live ? 'live' : 'dry-run',
    reminders,
    nags,
    stale: Number(stale?.count ?? 0),
    windowsClosed,
    failed,
  }
}
