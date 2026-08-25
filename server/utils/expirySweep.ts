/**
 * Gathering the sweep's inputs and carrying out its plan. The decisions all
 * live in the pure planner.
 */

import { db, schema } from '@nuxthub/db'
import { and, eq, gte, isNotNull, isNull, lt, ne, notLike } from 'drizzle-orm'
import {
  freshAdmins,
  isDigestWindow,
  planExpirySweep,
  type ExpiryPlan,
  type NotificationType,
  type SweepPerson,
  type SweepRecord,
} from './expiryPlan'
import { renderDigest, renderDryRunReport, renderMemberWarning, sendEmail } from './email'
import { getConfig, getConfigNumber } from './siteConfig'
import { notSupersededCondition } from './validity'
import { addMonths, today } from '../../shared/utils/dates'
import { writeAudit } from './audit'
import { chunk } from './d1'

export interface SweepResult {
  asOf: string
  mode: 'dry-run' | 'live'
  plan: ExpiryPlan
  sent: number
  failed: { to: string, type: NotificationType, error: string }[]
  /** Ledger rows past their retention, deleted whatever the mode. */
  pruned: number
}

/** Retention for the ledger, promised in docs/gdpr-retention.md. */
export const NOTIFICATION_RETENTION_MONTHS = 24

/** The oldest ledger row the sweep keeps. */
function retentionCutoff(asOf: string): Date {
  return new Date(`${addMonths(asOf, -NOTIFICATION_RETENTION_MONTHS)}T00:00:00Z`)
}

/** First day of `asOf`'s month, as epoch ms: the digest idempotency window. */
function startOfMonth(asOf: string): Date {
  return new Date(`${asOf.slice(0, 7)}-01T00:00:00Z`)
}

/**
 * Briefs are excluded at the source: they recur per event, never expire and
 * never gate (ADR-0003).
 */
export async function gatherSweepInputs(asOf: string, warningWindowDays: number, adminCacheDays = 90) {
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
      notSupersededCondition(),
    ))
    .all()

  const [people, leads, notified, digestsThisMonth] = await Promise.all([
    db.select({
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      isTrainingAdmin: schema.users.isTrainingAdmin,
      mirrorUpdatedAt: schema.users.updatedAt,
    }).from(schema.users)
      // Deliverable addresses only. An erased, merged-away or never-signed-in
      // mirror row holds a reserved .invalid address that can only bounce.
      .where(and(
        isNull(schema.users.anonymisedAt),
        isNull(schema.users.mergedInto),
        notLike(schema.users.email, '%.invalid'),
      )).all(),
    db.select({
      department: schema.departmentLeads.department,
      userId: schema.departmentLeads.userId,
    }).from(schema.departmentLeads).all(),
    db.select({
      recordId: schema.notificationLog.recordId,
      type: schema.notificationLog.type,
    }).from(schema.notificationLog)
      // Bounded by the same retention the prune applies: an older row is
      // about an expiry that has long since passed.
      .where(and(
        isNotNull(schema.notificationLog.recordId),
        gte(schema.notificationLog.sentAt, retentionCutoff(asOf)),
      )).all(),
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
    isDigestWindow: isDigestWindow(asOf),
    adminCacheDays,
  }
}

/**
 * What the sweep would do, without doing any of it: no sends, no audit
 * entry, so an operator can look as often as they like.
 */
export async function previewExpirySweep(asOf: string = today()): Promise<ExpiryPlan> {
  const [warningWindowDays, adminCacheDays] = await Promise.all([
    getConfigNumber('warning_window_days'),
    getConfigNumber('admin_cache_days'),
  ])
  return planExpirySweep(await gatherSweepInputs(asOf, warningWindowDays, adminCacheDays))
}

/**
 * In dry-run mode nothing is written to `notification_log`, so flipping to
 * live still delivers everything the dry run described.
 */
export async function runExpirySweep({
  asOf = today(),
  force,
}: { asOf?: string, force?: 'dry-run' | 'live' } = {}): Promise<SweepResult> {
  const [warningWindowDays, adminCacheDays, configuredMode] = await Promise.all([
    getConfigNumber('warning_window_days'),
    getConfigNumber('admin_cache_days'),
    getConfig('notifications_mode'),
  ])

  const mode = force ?? (configuredMode === 'live' ? 'live' : 'dry-run')
  const inputs = await gatherSweepInputs(asOf, warningWindowDays, adminCacheDays)
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
    // The report names every warned member, so stale cached admins get nothing:
    // the flag has no revocation path (docs/data-model.md).
    const admins = freshAdmins(inputs.people, asOf, inputs.adminCacheDays)

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

  // Housekeeping, not a notification, so it runs whatever the mode: the
  // retention promise is not the operator's to switch off.
  const pruned = await pruneNotificationLog(asOf)

  await writeAudit({
    actorUserId: null, // the cron has no actor
    action: 'expiry.sweep',
    target: asOf,
    detail: { mode, counts: plan.counts, sent, failed: failed.length, pruned },
  })

  return { asOf, mode, plan, sent, failed, pruned }
}

/** One predicate, so the parameter count never tracks the number of rows. */
export async function pruneNotificationLog(asOf: string = today()): Promise<number> {
  const gone = await db.delete(schema.notificationLog)
    .where(lt(schema.notificationLog.sentAt, retentionCutoff(asOf)))
    .returning({ id: schema.notificationLog.id })

  return gone.length
}
