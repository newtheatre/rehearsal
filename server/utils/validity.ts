/**
 * The single implementation of "is this record currently valid?"
 * (CLAUDE.md invariant 4 — two implementations is how safety systems lie).
 *
 * Validity is DERIVED from the record's stamped `expires_at` and today's
 * date. There is no state column and no transition job: a record's state
 * changes because the calendar moved, not because something ran.
 *
 * Semantics — docs/records-and-expiry.md:
 *   VALID     expires_at IS NULL, or expires_at > today
 *   EXPIRING  subset of VALID: expires_at within warning_window_days
 *   EXPIRED   expires_at <= today
 *
 * EXPIRING counts as valid everywhere it is gated on; it exists only to
 * drive warnings, so a person's ability never flickers off early.
 */

import { sql, isNull, and, type SQL } from 'drizzle-orm'
import { records } from '../db/schema/training'

export type ValidityState = 'VALID' | 'EXPIRING' | 'EXPIRED'

/** Today as an ISO date (YYYY-MM-DD) in UTC. */
export function today(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/** Add whole days to an ISO date, returning an ISO date. */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * The state of a single record.
 *
 * ISO date strings compare correctly as strings, which is why they are
 * stored as text and why this function and the SQL fragment below cannot
 * disagree.
 */
export function validityState(
  expiresAt: string | null | undefined,
  { asOf = today(), warningWindowDays = 60 }: { asOf?: string, warningWindowDays?: number } = {},
): ValidityState {
  if (!expiresAt) return 'VALID'
  if (expiresAt <= asOf) return 'EXPIRED'
  if (expiresAt <= addDays(asOf, warningWindowDays)) return 'EXPIRING'
  return 'VALID'
}

/** True for the states that count as held: VALID and EXPIRING. */
export function countsAsValid(state: ValidityState): boolean {
  return state !== 'EXPIRED'
}

/** Convenience: does this record currently count as held? */
export function isCurrentlyValid(
  expiresAt: string | null | undefined,
  options?: { asOf?: string, warningWindowDays?: number },
): boolean {
  return countsAsValid(validityState(expiresAt, options))
}

/**
 * SQL counterpart of `countsAsValid(validityState(...))` — VALID or EXPIRING.
 * Keep in lockstep with the functions above; tests assert they agree on the
 * same fixtures (docs/development.md#testing).
 */
export function validRecordCondition(asOf: string = today()): SQL {
  return sql`(${records.expiresAt} is null or ${records.expiresAt} > ${asOf})`
}

/** Records that have not been revoked (ADR-0008 — revoked never deleted). */
export function notRevokedCondition(): SQL {
  return sql`${records.revokedAt} is null`
}

/** Not revoked AND currently valid — the usual gate. */
export function heldRecordCondition(asOf: string = today()): SQL {
  return and(notRevokedCondition(), validRecordCondition(asOf))!
}

export { isNull }
