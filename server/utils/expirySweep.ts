/**
 * Gathering the sweep's inputs and carrying out its plan. The decisions all
 * live in the pure planner.
 */

import { db, schema } from '@nuxthub/db'
import { and, eq, gte, isNotNull, isNull, ne, sql } from 'drizzle-orm'
import {
  isDigestDay,
  planExpirySweep,
  type ExpiryPlan,
  type NotificationType,
  type SweepPerson,
  type SweepRecord,
} from './expiryPlan'
import { renderDigest, renderDryRunReport, renderMemberWarning, sendEmail } from './email'
import { getConfig, getConfigNumber } from './siteConfig'
import { today } from './validity'
import { writeAudit } from './audit'
import { chunk } from './d1'

export interface SweepResult {
  asOf: string
  mode: 'dry-run' | 'live'
  plan: ExpiryPlan
  sent: number
  failed: { to: string, type: NotificationType, error: string }[]
}

/** First day of `asOf`'s month, as epoch ms — the digest idempotency window. */
function startOfMonth(asOf: string): Date {
  return new Date(`${asOf.slice(0, 7)}-01T00:00:00Z`)
}

/**
 * Briefs are excluded at the source: they recur per event, never expire and
 * never gate (ADR-0003).
 */
export async function gatherSweepInputs(asOf: string, warningWindowDays: number) {
  const recordRows = await db.select({
    recordId: schema.records.id,
    userId: schema.records.userId,
    moduleId: schema.records.moduleId,
    moduleName: schema.modules.name,
    department: schema.modules.department,
    expiresAt: schema.records.expiresAt,
  })
    .from(schema.records)
    .innerJoin(schema.modules, eq(schema.records.moduleId, schema.modules.id))
    .where(and(
      isNull(schema.records.revokedAt),
      isNotNull(schema.records.expiresAt),
      ne(schema.modules.kind, 'BRIEF'),
      // Current record only: a superseded row's expiry is history, and
      // warning about it would tell someone their renewed training expired.
      sql`not exists (
        select 1 from records later
        where later.user_id = ${schema.records.userId}
          and later.module_id = ${schema.records.moduleId}
          and later.revoked_at is null
          and (later.awarded_at > ${schema.records.awardedAt}
            or (later.awarded_at = ${schema.records.awardedAt} and later.created_at > ${schema.records.createdAt}))
      )`,
    ))
    .all()

  const [people, leads, notified, digestsThisMonth] = await Promise.all([
    db.select({
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      isTrainingAdmin: schema.users.isTrainingAdmin,
    }).from(schema.users).all(),
    db.select({
      department: schema.departmentLeads.department,
      userId: schema.departmentLeads.userId,
    }).from(schema.departmentLeads).all(),
    db.select({
      recordId: schema.notificationLog.recordId,
      type: schema.notificationLog.type,
    }).from(schema.notificationLog)
      .where(isNotNull(schema.notificationLog.recordId)).all(),
    db.select({ userId: schema.notificationLog.userId })
      .from(schema.notificationLog)
      .where(and(
        eq(schema.notificationLog.type, 'digest.monthly'),
        gte(schema.notificationLog.sentAt, startOfMonth(asOf)),
      )).all(),
  ])

  return {
    asOf,
    warningWindowDays,
    records: recordRows.filter((r): r is SweepRecord => r.expiresAt !== null),
    people: people as SweepPerson[],
    leads,
    alreadyNotified: new Set(notified.map(n => `${n.recordId}:${n.type}`)),
    digestSentThisMonth: new Set(digestsThisMonth.map(d => d.userId)),
    isDigestDay: isDigestDay(asOf),
  }
}

/**
 * What the sweep would do, without doing any of it — no sends, no audit
 * entry, so an operator can look as often as they like.
 */
export async function previewExpirySweep(asOf: string = today()): Promise<ExpiryPlan> {
  const warningWindowDays = await getConfigNumber('warning_window_days')
  return planExpirySweep(await gatherSweepInputs(asOf, warningWindowDays))
}

/**
 * In dry-run mode nothing is written to `notification_log`, so flipping to
 * live still delivers everything the dry run described.
 */
export async function runExpirySweep({
  asOf = today(),
  force,
}: { asOf?: string, force?: 'dry-run' | 'live' } = {}): Promise<SweepResult> {
  const [warningWindowDays, configuredMode] = await Promise.all([
    getConfigNumber('warning_window_days'),
    getConfig('notifications_mode'),
  ])

  const mode = force ?? (configuredMode === 'live' ? 'live' : 'dry-run')
  const inputs = await gatherSweepInputs(asOf, warningWindowDays)
  const plan = planExpirySweep(inputs)

  const failed: SweepResult['failed'] = []
  let sent = 0

  if (mode === 'live') {
    for (const warning of plan.warnings) {
      const { subject, html } = renderMemberWarning(warning)
      try {
        await sendEmail({ to: warning.email, subject, html })
        // Logged only after a successful send, and chunked: six bound params
        // a row, and an unlogged send repeats tomorrow (d1.ts).
        for (const batch of chunk(warning.records, 15)) {
          await db.insert(schema.notificationLog).values(
            batch.map(record => ({
              userId: warning.userId,
              type: warning.type,
              recordId: record.recordId,
              moduleId: record.moduleId,
            })),
          )
        }
        sent++
      }
      catch (error) {
        failed.push({ to: warning.email, type: warning.type, error: String(error) })
      }
    }

    for (const digest of plan.digests) {
      const { subject, html } = renderDigest(digest, asOf)
      try {
        await sendEmail({ to: digest.email, subject, html })
        await db.insert(schema.notificationLog).values({
          userId: digest.userId,
          type: 'digest.monthly',
        })
        sent++
      }
      catch (error) {
        failed.push({ to: digest.email, type: 'digest.monthly', error: String(error) })
      }
    }
  }
  else {
    // Dry run: tell the admins what would have happened, tell nobody else.
    const { subject, html } = renderDryRunReport({ asOf, counts: plan.counts, warnings: plan.warnings, digests: plan.digests })
    const admins = inputs.people.filter(p => p.isTrainingAdmin)

    for (const admin of admins) {
      try {
        await sendEmail({ to: admin.email, subject, html })
        sent++
      }
      catch (error) {
        failed.push({ to: admin.email, type: 'digest.monthly', error: String(error) })
      }
    }
  }

  await writeAudit({
    actorUserId: null, // the cron has no actor
    action: 'expiry.sweep',
    target: asOf,
    detail: { mode, counts: plan.counts, sent, failed: failed.length },
  })

  return { asOf, mode, plan, sent, failed }
}
