/**
 * Expiry stamping — computed ONCE, at record creation, from the module's
 * policy at that moment (ADR-0002). Nothing recomputes this implicitly;
 * changing a module's policy affects future awards only.
 *
 * docs/records-and-expiry.md §expiry-modes.
 */

export interface ExpiryPolicy {
  expiryMode: 'NONE' | 'MONTHS' | 'ACADEMIC_YEAR'
  expiryMonths?: number | null
  kind?: 'MODULE' | 'CERTIFICATION' | 'BRIEF'
}

/** Default academic-year boundary; overridable via site_config. */
export const ACADEMIC_YEAR_END = '09-30'

/**
 * The next occurrence of the academic-year boundary strictly after
 * `awardedAt`. A fixed date, not a duration — which is why a mid-September
 * completion expires a fortnight later, and why the 1 October mass rollover
 * of inductions is emergent rather than special-cased.
 */
export function nextAcademicYearEnd(awardedAt: string, boundary: string = ACADEMIC_YEAR_END): string {
  const year = Number(awardedAt.slice(0, 4))
  const candidate = `${year}-${boundary}`
  return candidate > awardedAt ? candidate : `${year + 1}-${boundary}`
}

/** `awardedAt` plus N calendar months, clamped to the end of a short month. */
export function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const target = new Date(Date.UTC(y!, m! - 1 + months, 1))
  // Clamp: 31 Jan + 1 month is 28/29 Feb, not 3 March.
  const lastDayOfTargetMonth = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(d!, lastDayOfTargetMonth))
  return target.toISOString().slice(0, 10)
}

/**
 * The `expires_at` to stamp on a new record, or null for "never expires".
 *
 * `externalExpiresAt` (an EXTERNAL record's own certificate date) always
 * wins over the module's configured policy — the SU's certificate knows its
 * own expiry better than our config does.
 */
export function computeExpiresAt(
  module: ExpiryPolicy,
  awardedAt: string,
  { externalExpiresAt, academicYearEnd = ACADEMIC_YEAR_END }: { externalExpiresAt?: string | null, academicYearEnd?: string } = {},
): string | null {
  if (externalExpiresAt) return externalExpiresAt

  // Briefs recur per event; they never expire and never gate (ADR-0003).
  if (module.kind === 'BRIEF') return null

  switch (module.expiryMode) {
    case 'MONTHS':
      if (!module.expiryMonths || module.expiryMonths <= 0) {
        throw new Error('expiry_mode=MONTHS requires a positive expiry_months')
      }
      return addMonths(awardedAt, module.expiryMonths)
    case 'ACADEMIC_YEAR':
      return nextAcademicYearEnd(awardedAt, academicYearEnd)
    case 'NONE':
    default:
      return null
  }
}
