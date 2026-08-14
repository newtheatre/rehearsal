/**
 * The sweep end to end: gathering, sending, and the bookkeeping that makes a
 * second run send nothing new.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const sent: { to: string, subject: string }[] = []

// Intercept at the email boundary so the sweep's own logic runs for real.
vi.mock('../server/utils/email', async () => {
  const actual = await vi.importActual<typeof import('../server/utils/email')>('../server/utils/email')
  return {
    ...actual,
    sendEmail: vi.fn(async ({ to, subject }: { to: string, subject: string }) => {
      sent.push({ to, subject })
    }),
  }
})

const { db, schema } = await import('./mocks/nuxthub-db')
const { runExpirySweep, gatherSweepInputs } = await import('../server/utils/expirySweep')
const { seedDepartments, seedLead, seedModule, seedRecord, seedUser } = await import('./helpers/fixtures')

const ASOF = '2026-08-14'

async function setup() {
  await seedDepartments()
  await seedModule('NNT-001', { name: 'Theatre Induction', expiryMode: 'ACADEMIC_YEAR' })
  await seedModule('TECH-111', { name: 'Rigging' })
  await seedModule('NNT-002', { name: 'Get-In Brief', kind: 'BRIEF' })

  await seedUser('alice', 'Alice Anderson')
  await seedUser('tm', 'Tara Manager')
  await db.update(schema.users).set({ isTrainingAdmin: true })
    .where(eq(schema.users.id, 'tm'))
}

const { eq } = await import('drizzle-orm')

beforeEach(() => {
  sent.length = 0
})

describe('gathering inputs', () => {
  it('ignores records that never expire, briefs, and revoked rows', async () => {
    await setup()
    await seedRecord({ userId: 'alice', moduleId: 'NNT-001', expiresAt: '2026-09-30' })
    await seedRecord({ userId: 'alice', moduleId: 'TECH-111', expiresAt: null })
    await seedRecord({ userId: 'alice', moduleId: 'NNT-002', expiresAt: '2026-09-30' })
    await seedRecord({
      userId: 'tm',
      moduleId: 'NNT-001',
      expiresAt: '2026-09-30',
      revokedAt: new Date(),
      revokedBy: 'tm',
      revokeReason: 'Wrong person',
    })

    const inputs = await gatherSweepInputs(ASOF, 60)
    expect(inputs.records.map(r => r.moduleId)).toEqual(['NNT-001'])
    expect(inputs.records[0]!.userId).toBe('alice')
  })

  it('ignores a superseded record — the renewal is what counts', async () => {
    await setup()
    await seedRecord({ userId: 'alice', moduleId: 'NNT-001', awardedAt: '2025-01-01', expiresAt: '2025-09-30' })
    await seedRecord({ userId: 'alice', moduleId: 'NNT-001', awardedAt: '2026-01-01', expiresAt: '2027-09-30' })

    const inputs = await gatherSweepInputs(ASOF, 60)
    // Warning someone that their renewed training expired last year would be
    // both wrong and alarming.
    expect(inputs.records).toHaveLength(1)
    expect(inputs.records[0]!.expiresAt).toBe('2027-09-30')
  })
})

describe('dry run', () => {
  it('reports to admins, tells members nothing, and records nothing as sent', async () => {
    await setup()
    await seedRecord({ userId: 'alice', moduleId: 'NNT-001', expiresAt: '2026-09-30' })

    const result = await runExpirySweep({ asOf: ASOF })

    expect(result.mode).toBe('dry-run')
    expect(result.plan.warnings).toHaveLength(1)

    // Only the admin heard anything.
    expect(sent.map(s => s.to)).toEqual(['tm@dev.newtheatre.org.uk'])
    expect(sent[0]!.subject).toContain('[dry run]')

    // Crucially: nothing logged, so flipping to live still delivers it.
    expect(await db.select().from(schema.notificationLog).all()).toHaveLength(0)
  })

  it('leaves the same warning outstanding for the first live run', async () => {
    await setup()
    await seedRecord({ userId: 'alice', moduleId: 'NNT-001', expiresAt: '2026-09-30' })

    await runExpirySweep({ asOf: ASOF })
    sent.length = 0
    const live = await runExpirySweep({ asOf: ASOF, force: 'live' })

    expect(live.plan.warnings).toHaveLength(1)
    expect(sent.map(s => s.to)).toEqual(['alice@dev.newtheatre.org.uk'])
  })
})

describe('live run', () => {
  it('emails the member and logs what it sent', async () => {
    await setup()
    await seedRecord({ userId: 'alice', moduleId: 'NNT-001', expiresAt: '2026-09-30' })

    const result = await runExpirySweep({ asOf: ASOF, force: 'live' })

    expect(result.sent).toBe(1)
    expect(sent[0]!.to).toBe('alice@dev.newtheatre.org.uk')

    const log = await db.select().from(schema.notificationLog).all()
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ userId: 'alice', type: 'expiry.window', moduleId: 'NNT-001' })
  })

  it('sends nothing new when run twice on the same day', async () => {
    await setup()
    await seedRecord({ userId: 'alice', moduleId: 'NNT-001', expiresAt: '2026-09-30' })

    await runExpirySweep({ asOf: ASOF, force: 'live' })
    sent.length = 0
    const second = await runExpirySweep({ asOf: ASOF, force: 'live' })

    expect(second.plan.warnings).toEqual([])
    expect(sent).toEqual([])
    expect(await db.select().from(schema.notificationLog).all()).toHaveLength(1)
  })

  it('still escalates to the urgent warning later in the month', async () => {
    await setup()
    await seedRecord({ userId: 'alice', moduleId: 'NNT-001', expiresAt: '2026-09-30' })

    await runExpirySweep({ asOf: '2026-08-14', force: 'live' })
    sent.length = 0
    const later = await runExpirySweep({ asOf: '2026-09-20', force: 'live' })

    expect(later.plan.warnings[0]!.type).toBe('expiry.14day')
    expect(sent).toHaveLength(1)

    const types = (await db.select().from(schema.notificationLog).all()).map(l => l.type).sort()
    expect(types).toEqual(['expiry.14day', 'expiry.window'])
  })

  it('logs one row per record when several are covered by one email', async () => {
    await setup()
    await seedModule('TECH-112', { name: 'Desk', expiryMode: 'ACADEMIC_YEAR' })
    await seedRecord({ userId: 'alice', moduleId: 'NNT-001', expiresAt: '2026-09-30' })
    await seedRecord({ userId: 'alice', moduleId: 'TECH-112', expiresAt: '2026-10-01' })

    await runExpirySweep({ asOf: ASOF, force: 'live' })

    // One email, two records — so a change to one of them later is tracked
    // independently.
    expect(sent).toHaveLength(1)
    expect(await db.select().from(schema.notificationLog).all()).toHaveLength(2)
  })

  it('does not mark a failed send as delivered', async () => {
    await setup()
    await seedRecord({ userId: 'alice', moduleId: 'NNT-001', expiresAt: '2026-09-30' })

    const email = await import('../server/utils/email')
    vi.mocked(email.sendEmail).mockRejectedValueOnce(new Error('Resend is down'))

    const result = await runExpirySweep({ asOf: ASOF, force: 'live' })

    expect(result.failed).toHaveLength(1)
    // Nothing logged, so tomorrow's sweep tries again.
    expect(await db.select().from(schema.notificationLog).all()).toHaveLength(0)
  })
})

describe('monthly digest', () => {
  it('goes out on the 1st and not again that month', async () => {
    await setup()
    await seedLead('TECH', 'alice')
    await seedRecord({ userId: 'alice', moduleId: 'NNT-001', expiresAt: '2026-09-30' })

    const first = await runExpirySweep({ asOf: '2026-09-01', force: 'live' })
    expect(first.plan.digests).toHaveLength(2) // lead + admin

    sent.length = 0
    const second = await runExpirySweep({ asOf: '2026-09-02', force: 'live' })
    expect(second.plan.digests).toEqual([])

    const third = await runExpirySweep({ asOf: '2026-10-01', force: 'live' })
    expect(third.plan.digests).toHaveLength(2)
  })
})

describe('audit', () => {
  it('records every sweep, including dry runs', async () => {
    await setup()
    await runExpirySweep({ asOf: ASOF })

    const [entry] = await db.select().from(schema.auditLog).all()
    expect(entry!.action).toBe('expiry.sweep')
    // No actor: the cron is not a person.
    expect(entry!.actorUserId).toBeNull()
    expect(JSON.parse(entry!.detail!).mode).toBe('dry-run')
  })
})
