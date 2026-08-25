/**
 * Expiry stamping: computed ONCE, at record creation (ADR-0002). Changing a
 * module's policy affects future awards only.
 */

import { CONFIG_DEFAULTS } from '../../shared/utils/configDefaults'
import { addMonths, daysBetween } from '../../shared/utils/dates'

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
 * A real MM-DD day. 2001 is deliberately not a leap year: the boundary has to
 * fall in every year, so 02-29 is refused alongside 09-31.
 */
export function isAcademicYearBoundary(value: string): boolean {
  if (!/^\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`2001-${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(5, 10) === value
}

/**
 * The next academic-year boundary after `awardedAt`, carrying over to the
 * following one when this one is too close to be worth holding (ADR-0011).
 */
export function nextAcademicYearEnd(awardedAt: string, boundary: string = ACADEMIC_YEAR_END): string {
  // Refuse rather than stamp: a date no parser accepts reads as VALID forever.
  if (!isAcademicYearBoundary(boundary)) {
    throw new Error(`academic_year_end "${boundary}" is not a real MM-DD date`)
  }

  const year = Number(awardedAt.slice(0, 4))
  const candidate = `${year}-${boundary}` > awardedAt ? `${year}-${boundary}` : `${year + 1}-${boundary}`

  if (daysBetween(awardedAt, candidate) >= ACADEMIC_YEAR_CARRY_OVER_DAYS) return candidate
  return `${Number(candidate.slice(0, 4)) + 1}-${boundary}`
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
