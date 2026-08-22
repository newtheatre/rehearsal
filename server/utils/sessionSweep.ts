/**
 * The daily session sweep: tomorrow's reminders, and nagging a lead whose
 * register is still unmarked. Neither creates or destroys a record.
 */

import { db, schema } from '@nuxthub/db'
import { and, eq, gte, inArray, lt } from 'drizzle-orm'
import { renderRegisterNag, renderSessionReminder, sendEmail } from './email'
import { addressableUsers, sessionEmailSummary, type Recipient } from './sessionNotify'
import { registerFor } from './scheduling'
import { sweepExpiredWindows } from './practice'
import { getConfig, getConfigNumber } from './siteConfig'
import { today } from '../../shared/utils/dates'

export type SessionNotificationType = 'session.reminder' | 'session.nag'

export interface SessionSweepResult {
  asOf: string
  mode: 'dry-run' | 'live'
  reminders: number
  nags: number
  windowsClosed: number
  failed: number
}

/** ISO date `days` after `from`. */
function addDays(from: string, days: number): string {
  const date = new Date(`${from}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** A nag repeats, but weekly rather than every morning. */
const NAG_INTERVAL_DAYS = 7

/** When each notification last went out, so a re-run sends nothing new. */
async function lastSent(sessionIds: string[]): Promise<Map<string, Date>> {
  if (sessionIds.length === 0) return new Map()
  const rows = await db.select({
    sessionId: schema.notificationLog.sessionId,
    userId: schema.notificationLog.userId,
    type: schema.notificationLog.type,
    sentAt: schema.notificationLog.sentAt,
  })
    .from(schema.notificationLog)
    .where(inArray(schema.notificationLog.sessionId, sessionIds))
    .all()

  const latest = new Map<string, Date>()
  for (const row of rows) {
    const key = `${row.sessionId}:${row.userId}:${row.type}`
    const seen = latest.get(key)
    if (!seen || row.sentAt > seen) latest.set(key, row.sentAt)
  }
  return latest
}

export async function runSessionSweep(asOf: string = today()): Promise<SessionSweepResult> {
  const [mode, reminderDays, nagDays] = await Promise.all([
    getConfig('notifications_mode'),
    getConfigNumber('session_reminder_days'),
    getConfigNumber('register_nag_days'),
  ])
  const live = mode === 'live'

  const reminderDay = addDays(asOf, reminderDays)

  const [dueReminders, unmarked] = await Promise.all([
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
        gte(schema.sessions.heldOn, addDays(asOf, -60)),
        inArray(schema.sessions.status, ['OPEN', 'FULL']),
      ))
      .all(),
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
      }))
      if (ok) reminders++
    }
  }

  for (const session of unmarked) {
    const summary = await sessionEmailSummary(session.id)
    if (!summary) continue

    const daysAgo = Math.round(
      (Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${session.heldOn}T00:00:00Z`)) / 86_400_000,
    )
    if (daysAgo < nagDays) continue

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

  return { asOf, mode: live ? 'live' : 'dry-run', reminders, nags, windowsClosed, failed }
}
