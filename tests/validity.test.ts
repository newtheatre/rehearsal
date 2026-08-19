/**
 * Validity derivation and expiry stamping: the semantics everything else,
 * and every API consumer, depends on. docs/records-and-expiry.md
 */

import { describe, it, expect } from 'vitest'
import { validityState, countsAsValid, isCurrentlyValid, addDays } from '../server/utils/validity'
import { today } from '../shared/utils/dates'
import { computeExpiresAt, nextAcademicYearEnd, addMonths } from '../server/utils/expiry'

const asOf = '2026-08-14'

describe('today()', () => {
  it('is the London date, not the UTC one, during BST', () => {
    // 00:30 on 1 July in London is still 30 June in UTC. Judging validity by
    // the UTC date would keep a lapsed certification alive for that hour.
    const earlyBst = new Date('2026-07-01T00:30:00+01:00')
    expect(earlyBst.toISOString().slice(0, 10)).toBe('2026-06-30')
    expect(today(earlyBst)).toBe('2026-07-01')
  })

  it('agrees with UTC outside BST', () => {
    expect(today(new Date('2026-01-15T00:30:00Z'))).toBe('2026-01-15')
  })
})

describe('validityState', () => {
  it('treats a null expiry as permanently valid', () => {
    expect(validityState(null, { asOf })).toBe('VALID')
    expect(validityState(undefined, { asOf })).toBe('VALID')
  })

  it('expires ON the expiry date, not after it', () => {
    // The boundary that matters: "expires today" must gate today, not tomorrow.
    expect(validityState('2026-08-14', { asOf })).toBe('EXPIRED')
    expect(validityState('2026-08-15', { asOf, warningWindowDays: 0 })).toBe('VALID')
  })

  it('reports EXPIRING inside the warning window and VALID outside it', () => {
    expect(validityState('2026-10-13', { asOf, warningWindowDays: 60 })).toBe('EXPIRING')
    expect(validityState('2026-10-14', { asOf, warningWindowDays: 60 })).toBe('VALID')
  })

  it('counts EXPIRING as held, an ability must not flicker off early', () => {
    expect(countsAsValid('EXPIRING')).toBe(true)
    expect(countsAsValid('VALID')).toBe(true)
    expect(countsAsValid('EXPIRED')).toBe(false)
    expect(isCurrentlyValid('2026-08-20', { asOf })).toBe(true)
    expect(isCurrentlyValid('2026-08-14', { asOf })).toBe(false)
  })
})

describe('addDays', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29') // leap year
  })
})

describe('nextAcademicYearEnd', () => {
  it('returns the next 30 September strictly after the award', () => {
    expect(nextAcademicYearEnd('2026-10-12')).toBe('2027-09-30')
    expect(nextAcademicYearEnd('2027-01-15')).toBe('2027-09-30')
  })

  it('gives a mid-September award only days of validity, that is what an academic-year gate means', () => {
    expect(nextAcademicYearEnd('2027-09-15')).toBe('2027-09-30')
  })

  it('rolls to the following year when awarded ON the boundary', () => {
    // "Strictly after": a 30 Sep award must not expire the same day.
    expect(nextAcademicYearEnd('2027-09-30')).toBe('2028-09-30')
    expect(nextAcademicYearEnd('2027-10-01')).toBe('2028-09-30')
  })
})

describe('addMonths', () => {
  it('adds calendar months', () => {
    expect(addMonths('2026-08-14', 12)).toBe('2027-08-14')
    expect(addMonths('2026-08-14', 24)).toBe('2028-08-14')
  })

  it('clamps to the end of a shorter target month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29')
  })
})

describe('computeExpiresAt', () => {
  it('stamps nothing for NONE', () => {
    expect(computeExpiresAt({ expiryMode: 'NONE' }, '2026-08-14')).toBeNull()
  })

  it('stamps months and academic years', () => {
    expect(computeExpiresAt({ expiryMode: 'MONTHS', expiryMonths: 36 }, '2026-08-14')).toBe('2029-08-14')
    expect(computeExpiresAt({ expiryMode: 'ACADEMIC_YEAR' }, '2026-10-12')).toBe('2027-09-30')
  })

  it('lets an external certificate\'s own date win over module config', () => {
    // The SU's certificate knows its expiry better than our config does.
    expect(computeExpiresAt(
      { expiryMode: 'MONTHS', expiryMonths: 36 },
      '2026-11-01',
      { externalExpiresAt: '2028-03-03' },
    )).toBe('2028-03-03')
  })

  it('never expires a brief, whatever the config says', () => {
    expect(computeExpiresAt(
      { expiryMode: 'ACADEMIC_YEAR', kind: 'BRIEF' },
      '2026-08-14',
    )).toBeNull()
  })

  it('refuses MONTHS with no interval rather than stamping a nonsense date', () => {
    expect(() => computeExpiresAt({ expiryMode: 'MONTHS', expiryMonths: null }, '2026-08-14')).toThrow()
  })
})
