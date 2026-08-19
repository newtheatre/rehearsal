/**
 * The single implementation of "is this record valid?" (invariant 4).
 * Derived, never stored. States: docs/records-and-expiry.md
 */

import { sql, and, type SQL } from 'drizzle-orm'
import { records } from '../db/schema/training'
import { today } from '../../shared/utils/dates'

export type ValidityState = 'VALID' | 'EXPIRING' | 'EXPIRED'

/** Add whole days to an ISO date, returning an ISO date. */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * ISO date strings compare correctly as strings, which is why they are stored
 * as text and why this and the SQL fragment below cannot disagree.
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
 * SQL counterpart of countsAsValid(validityState(...)). Keep in lockstep;
 * tests assert they agree on the same fixtures.
 */
export function validRecordCondition(asOf: string = today()): SQL {
  return sql`(${records.expiresAt} is null or ${records.expiresAt} > ${asOf})`
}

/** Records that have not been revoked (ADR-0008 — revoked never deleted). */
export function notRevokedCondition(): SQL {
  return sql`${records.revokedAt} is null`
}

/**
 * The latest non-revoked row for its (user, module). Superseded rows stay as
 * history: re-training does not erase the earlier session (ADR-0008).
 */
export function notSupersededCondition(): SQL {
  return sql`not exists (
    select 1 from records later
    where later.user_id = ${records.userId}
      and later.module_id = ${records.moduleId}
      and later.revoked_at is null
      and (
        later.awarded_at > ${records.awardedAt}
        or (later.awarded_at = ${records.awardedAt} and later.created_at > ${records.createdAt})
      )
  )`
}

/** Not revoked AND currently valid — the usual gate. */
export function heldRecordCondition(asOf: string = today()): SQL {
  return and(notRevokedCondition(), validRecordCondition(asOf))!
}
