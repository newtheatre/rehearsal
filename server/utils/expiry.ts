/**
 * Expiry stamping: computed ONCE, at record creation (ADR-0002). Changing a
 * module's policy affects future awards only.
 */

import { CONFIG_DEFAULTS } from '../../shared/utils/configDefaults'
import { daysBetween } from '../../shared/utils/dates'

export interface ExpiryPolicy {
  expiryMode: 'NONE' | 'MONTHS' | 'ACADEMIC_YEAR'
  expiryMonths?: number | null
  kind?: 'MODULE' | 'CERTIFICATION' | 'BRIEF'
}

/** Default academic-year boundary; overridable via site_config. */
export const ACADEMIC_YEAR_END = CONFIG_DEFAULTS.academic_year_end

/**
 * A constant rather than config, like FINAL_WARNING_DAYS: a second dial
 * invites it being set inconsistently with the warning window (ADR-0011).
 */
export const ACADEMIC_YEAR_CARRY_OVER_DAYS = 60

/**
 * The next academic-year boundary after `awardedAt`, carrying over to the
 * following one when this one is too close to be worth holding (ADR-0011).
 */
export function nextAcademicYearEnd(awardedAt: string, boundary: string = ACADEMIC_YEAR_END): string {
  const year = Number(awardedAt.slice(0, 4))
  const candidate = `${year}-${boundary}` > awardedAt ? `${year}-${boundary}` : `${year + 1}-${boundary}`

  if (daysBetween(awardedAt, candidate) >= ACADEMIC_YEAR_CARRY_OVER_DAYS) return candidate
  return `${Number(candidate.slice(0, 4)) + 1}-${boundary}`
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

/** Present means overridden; the date inside may be null for never (ADR-0012). */
export interface ExpiryOverride {
  expiresAt: string | null
}

/**
 * A certificate's or a signer's own date wins over the module's policy. The
 * wrapper is what separates "no override" from "override to never".
 */
export function computeExpiresAt(
  module: ExpiryPolicy,
  awardedAt: string,
  { override, academicYearEnd = ACADEMIC_YEAR_END }: { override?: ExpiryOverride, academicYearEnd?: string } = {},
): string | null {
  // Briefs recur per event; they never expire and never gate (ADR-0003).
  // Ahead of the override, or an external brief could be given an expiry.
  if (module.kind === 'BRIEF') return null

  if (override) return override.expiresAt

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
