/**
 * The expiry sweep planner.
 *
 * Phase 3's acceptance criterion is that "the dry-run output for seeded test
 * data is exactly as predicted" — so these assert the whole plan, not just
 * that something was produced.
 */

import { describe, it, expect } from 'vitest'
import {
  daysBetween,
  isDigestDay,
  planExpirySweep,
  FINAL_WARNING_DAYS,
  type SweepInputs,
  type SweepRecord,
} from '../server/utils/expiryPlan'

const people = [
  { id: 'alice', email: 'alice@nnt.test', name: 'Alice Anderson', isTrainingAdmin: false },
  { id: 'bob', email: 'bob@nnt.test', name: 'Bob Brown', isTrainingAdmin: false },
  { id: 'ctd', email: 'ctd@nnt.test', name: 'Chris Tech', isTrainingAdmin: false },
  { id: 'tm', email: 'tm@nnt.test', name: 'Tara Manager', isTrainingAdmin: true },
]

function record(overrides: Partial<SweepRecord> & { recordId: string, expiresAt: string }): SweepRecord {
  return {
    userId: 'alice',
    moduleId: 'NNT-001',
    moduleName: 'Theatre Induction',
    department: 'NNT',
    ...overrides,
  }
}

function inputs(overrides: Partial<SweepInputs> = {}): SweepInputs {
  return {
    asOf: '2026-08-14',
    warningWindowDays: 60,
    records: [],
    people,
    leads: [{ department: 'TECH', userId: 'ctd' }],
    alreadyNotified: new Set(),
    digestSentThisMonth: new Set(),
    isDigestDay: false,
    ...overrides,
  }
}

describe('daysBetween', () => {
  it('counts whole days across months', () => {
    expect(daysBetween('2026-08-14', '2026-08-28')).toBe(14)
    expect(daysBetween('2026-08-14', '2026-09-30')).toBe(47)
    expect(daysBetween('2026-08-14', '2026-08-14')).toBe(0)
  })
})

describe('which warning fires', () => {
  it('says nothing about a record comfortably in date', () => {
    const plan = planExpirySweep(inputs({
      records: [record({ recordId: 'r1', expiresAt: '2027-01-01' })],
    }))
    expect(plan.warnings).toEqual([])
    expect(plan.counts.expiring).toBe(0)
  })

  it('sends the gentle warning on entering the window', () => {
    // 47 days out: inside the 60-day window, outside the final fortnight.
    const plan = planExpirySweep(inputs({
      records: [record({ recordId: 'r1', expiresAt: '2026-09-30' })],
    }))

    expect(plan.warnings).toHaveLength(1)
    expect(plan.warnings[0]).toMatchObject({
      userId: 'alice',
      email: 'alice@nnt.test',
      type: 'expiry.window',
    })
    expect(plan.warnings[0]!.records.map(r => r.recordId)).toEqual(['r1'])
  })

  it('sends the urgent warning inside the final fortnight, not the gentle one', () => {
    const plan = planExpirySweep(inputs({
      records: [record({ recordId: 'r1', expiresAt: '2026-08-20' })],
    }))
    expect(plan.warnings[0]!.type).toBe('expiry.14day')
  })

  it('switches type exactly at the boundary', () => {
    const at = planExpirySweep(inputs({
      records: [record({ recordId: 'r1', expiresAt: '2026-08-28' })], // 14 days
    }))
    const justOutside = planExpirySweep(inputs({
      records: [record({ recordId: 'r1', expiresAt: '2026-08-29' })], // 15 days
    }))

    expect(daysBetween('2026-08-14', '2026-08-28')).toBe(FINAL_WARNING_DAYS)
    expect(at.warnings[0]!.type).toBe('expiry.14day')
    expect(justOutside.warnings[0]!.type).toBe('expiry.window')
  })

  it('does not email members about training that has already expired', () => {
    // Expired training belongs in the digest, not in a nag to the member —
    // the warnings already went out before it lapsed.
    const plan = planExpirySweep(inputs({
      records: [record({ recordId: 'r1', expiresAt: '2020-09-30' })],
    }))

    expect(plan.warnings).toEqual([])
    expect(plan.counts.expired).toBe(1)
  })

  it('groups one member’s modules into a single email per type', () => {
    const plan = planExpirySweep(inputs({
      records: [
        record({ recordId: 'r1', expiresAt: '2026-09-30' }),
        record({ recordId: 'r2', moduleId: 'TECH-111', expiresAt: '2026-10-01' }),
        record({ recordId: 'r3', moduleId: 'SFTY-002', expiresAt: '2026-08-20' }),
      ],
    }))

    expect(plan.warnings).toHaveLength(2)
    const window = plan.warnings.find(w => w.type === 'expiry.window')!
    const urgent = plan.warnings.find(w => w.type === 'expiry.14day')!
    // Soonest first, so the email leads with what matters most.
    expect(window.records.map(r => r.recordId)).toEqual(['r1', 'r2'])
    expect(urgent.records.map(r => r.recordId)).toEqual(['r3'])
  })

  it('counts a record it cannot address rather than dropping it silently', () => {
    const plan = planExpirySweep(inputs({
      records: [record({ recordId: 'r1', userId: 'ghost', expiresAt: '2026-09-30' })],
    }))

    expect(plan.warnings).toEqual([])
    expect(plan.counts.unaddressable).toBe(1)
  })
})

describe('idempotency', () => {
  it('skips a warning already sent for that record and type', () => {
    const plan = planExpirySweep(inputs({
      records: [record({ recordId: 'r1', expiresAt: '2026-09-30' })],
      alreadyNotified: new Set(['r1:expiry.window']),
    }))
    expect(plan.warnings).toEqual([])
  })

  it('still sends the urgent warning to someone already warned gently', () => {
    // The two warnings are independent: having had the 60-day nudge must not
    // suppress the one a fortnight out.
    const plan = planExpirySweep(inputs({
      records: [record({ recordId: 'r1', expiresAt: '2026-08-20' })],
      alreadyNotified: new Set(['r1:expiry.window']),
    }))
    expect(plan.warnings[0]!.type).toBe('expiry.14day')
  })
})

describe('monthly digests', () => {
  const expiringSoon = record({ recordId: 'r1', expiresAt: '2026-09-30' })
  const techExpired = record({
    recordId: 'r2', userId: 'bob', moduleId: 'TECH-111', department: 'TECH', expiresAt: '2020-01-01',
  })

  it('sends none on an ordinary day', () => {
    const plan = planExpirySweep(inputs({ records: [expiringSoon], isDigestDay: false }))
    expect(plan.digests).toEqual([])
  })

  it('gives a lead only their own department, and an admin everything', () => {
    const plan = planExpirySweep(inputs({
      records: [expiringSoon, techExpired],
      isDigestDay: true,
    }))

    const lead = plan.digests.find(d => d.userId === 'ctd')!
    expect(lead.departments).toEqual(['TECH'])
    expect(lead.expiring).toEqual([])
    expect(lead.expired.map(r => r.recordId)).toEqual(['r2'])

    const admin = plan.digests.find(d => d.userId === 'tm')!
    expect(admin.departments).toBeNull()
    expect(admin.expiring.map(r => r.recordId)).toEqual(['r1'])
    expect(admin.expired.map(r => r.recordId)).toEqual(['r2'])
  })

  it('sends an empty digest anyway — its absence is the alert', () => {
    const plan = planExpirySweep(inputs({ records: [], isDigestDay: true }))

    expect(plan.digests).toHaveLength(2) // the lead and the admin
    expect(plan.digests.every(d => d.expiring.length === 0 && d.expired.length === 0)).toBe(true)
  })

  it('does not send a second digest in the same month', () => {
    const plan = planExpirySweep(inputs({
      records: [expiringSoon],
      isDigestDay: true,
      digestSentThisMonth: new Set(['ctd', 'tm']),
    }))
    expect(plan.digests).toEqual([])
  })

  it('gives an admin who also leads a department the full picture', () => {
    const plan = planExpirySweep(inputs({
      records: [expiringSoon, techExpired],
      leads: [{ department: 'TECH', userId: 'tm' }],
      isDigestDay: true,
    }))

    expect(plan.digests).toHaveLength(1)
    expect(plan.digests[0]!.departments).toBeNull()
  })

  it('recognises the first of the month', () => {
    expect(isDigestDay('2026-09-01')).toBe(true)
    expect(isDigestDay('2026-09-30')).toBe(false)
  })
})

describe('the 1 October rollover', () => {
  it('warns everyone at once as 30 September approaches, then digests them as expired', () => {
    // Every induction expires 30 Sep by design, so the sweep must cope with
    // the whole membership landing in the window together.
    const inductions = ['alice', 'bob', 'ctd'].map((userId, i) =>
      record({ recordId: `r${i}`, userId, expiresAt: '2026-09-30' }),
    )

    const septemberFirst = planExpirySweep(inputs({
      asOf: '2026-09-01',
      records: inductions,
      isDigestDay: true,
    }))
    // 29 days out: gentle warning, and the digest that tells leads to book
    // October inductions.
    expect(septemberFirst.warnings.map(w => w.type)).toEqual(['expiry.window', 'expiry.window', 'expiry.window'])
    expect(septemberFirst.counts.expiring).toBe(3)

    const midSeptember = planExpirySweep(inputs({
      asOf: '2026-09-20',
      records: inductions,
      alreadyNotified: new Set(inductions.map(r => `${r.recordId}:expiry.window`)),
    }))
    expect(midSeptember.warnings.map(w => w.type)).toEqual(['expiry.14day', 'expiry.14day', 'expiry.14day'])

    const october = planExpirySweep(inputs({
      asOf: '2026-10-01',
      records: inductions,
      isDigestDay: true,
    }))
    // The mass expiry is emergent: nothing ran, the date simply passed.
    expect(october.counts.expired).toBe(3)
    expect(october.warnings).toEqual([])
    expect(october.digests.find(d => d.userId === 'tm')!.expired).toHaveLength(3)
  })
})

describe('the whole plan, exactly', () => {
  it('is fully predictable for a fixed fixture', () => {
    const plan = planExpirySweep(inputs({
      asOf: '2026-09-01',
      isDigestDay: true,
      records: [
        record({ recordId: 'r1', userId: 'alice', expiresAt: '2026-09-30' }),
        record({ recordId: 'r2', userId: 'bob', moduleId: 'TECH-111', department: 'TECH', expiresAt: '2026-09-10' }),
        record({ recordId: 'r3', userId: 'bob', moduleId: 'SFTY-002', department: 'SFTY', expiresAt: '2025-01-01' }),
        record({ recordId: 'r4', userId: 'ctd', moduleId: 'TECH-112', department: 'TECH', expiresAt: '2028-01-01' }),
      ],
    }))

    expect(plan.counts).toEqual({
      recordsConsidered: 4,
      expiring: 2,
      expired: 1,
      windowWarnings: 1,
      finalWarnings: 1,
      digests: 2,
      unaddressable: 0,
    })

    expect(plan.warnings.map(w => [w.name, w.type, w.records.map(r => r.moduleId)])).toEqual([
      ['Alice Anderson', 'expiry.window', ['NNT-001']],
      ['Bob Brown', 'expiry.14day', ['TECH-111']],
    ])

    expect(plan.digests.map(d => [d.name, d.departments, d.expiring.length, d.expired.length])).toEqual([
      ['Chris Tech', ['TECH'], 1, 0],
      ['Tara Manager', null, 2, 1],
    ])
  })
})
