/**
 * The expiry recalculation tool: the only retroactive path (ADR-0002).
 *
 * The interesting behaviour is everything it refuses to touch.
 */

import { describe, it, expect } from 'bun:test'
import recalculateHandler from '../server/api/admin/recalculate.post'
import configHandler from '../server/api/admin/config.put'
import { planRecalculation } from '../server/utils/recalculate'
import { db, schema } from './mocks/nuxthub-db'
import { eq } from 'drizzle-orm'
import { makeEvent, signIn, type FakeEvent } from './setup'
import { seedDepartments, seedModule, seedRecord, seedUser } from './helpers/fixtures'

type Handler = (event: FakeEvent) => Promise<unknown>
const call = (handler: unknown, event: FakeEvent) => (handler as Handler)(event)

async function setup() {
  await seedDepartments()
  await seedUser('alice', 'Alice')
  await seedUser('tm', 'Theatre Manager')
  await seedModule('TECH-121', { name: 'Powered Tools', expiryMode: 'NONE' })
  await seedRecord({ userId: 'alice', moduleId: 'TECH-121', awardedAt: '2026-01-15', expiresAt: null })
}

function adminEvent(body: unknown) {
  const event = makeEvent({ method: 'POST', path: '/api/admin/recalculate', body })
  signIn(event, { id: 'tm', roles: ['training:ADMIN'] })
  return event
}

describe('planning a recalculation', () => {
  it('finds records whose stored expiry no longer matches the policy', async () => {
    await setup()
    // The committee decides powered tools should be renewed yearly.
    await db.update(schema.modules)
      .set({ expiryMode: 'MONTHS', expiryMonths: 12 })
      .where(eq(schema.modules.id, 'TECH-121'))

    const plan = await planRecalculation({ academicYearEnd: '09-30' })

    expect(plan.changes).toHaveLength(1)
    expect(plan.changes[0]).toMatchObject({
      moduleId: 'TECH-121',
      userName: 'Alice',
      from: null,
      to: '2027-01-15',
    })
  })

  it('reports nothing when the policy has not moved', async () => {
    await setup()
    const plan = await planRecalculation({ academicYearEnd: '09-30' })
    expect(plan.changes).toEqual([])
    expect(plan.unchanged).toBe(1)
  })

  it('never touches an external certificate', async () => {
    await setup()
    await seedModule('SFTY-101', { department: 'NNT', name: 'First Aid', expiryMode: 'MONTHS', expiryMonths: 36 })
    await seedRecord({
      userId: 'alice',
      moduleId: 'SFTY-101',
      awardedAt: '2026-01-15',
      expiresAt: '2028-03-03',
      source: 'EXTERNAL',
      externalRef: 'SU EFAW',
      expiryOverridden: true,
    })

    const plan = await planRecalculation({ academicYearEnd: '09-30' })

    // The SU does not reissue a certificate because we changed a dropdown.
    expect(plan.changes.find(c => c.moduleId === 'SFTY-101')).toBeUndefined()
    expect(plan.skippedOverridden).toBe(1)
  })

  it('skips a sign-off whose expiry was set explicitly, and moves its twin', async () => {
    await setup()
    await db.update(schema.modules)
      .set({ expiryMode: 'MONTHS', expiryMonths: 12 })
      .where(eq(schema.modules.id, 'TECH-121'))
    await seedUser('bob', 'Bob')
    // Two rows differing only in the marker, so this fails for any
    // implementation still branching on source.
    await seedRecord({
      userId: 'bob', moduleId: 'TECH-121', awardedAt: '2026-01-15',
      expiresAt: '2030-01-01', source: 'SIGNOFF', expiryOverridden: true,
    })

    const plan = await planRecalculation({ academicYearEnd: '08-31' })

    expect(plan.skippedOverridden).toBe(1)
    expect(plan.changes.find(c => c.userId === 'bob')).toBeUndefined()
    expect(plan.changes.find(c => c.userId === 'alice')).toBeDefined()
  })

  it('leaves an explicit never-expires alone rather than giving it a date', async () => {
    await setup()
    await db.update(schema.modules)
      .set({ expiryMode: 'MONTHS', expiryMonths: 12 })
      .where(eq(schema.modules.id, 'TECH-121'))
    await seedUser('bob', 'Bob')
    await seedRecord({
      userId: 'bob', moduleId: 'TECH-121', awardedAt: '2026-01-15',
      expiresAt: null, source: 'SIGNOFF', expiryOverridden: true,
    })

    const plan = await planRecalculation({ academicYearEnd: '08-31' })

    expect(plan.changes.find(c => c.userId === 'bob')).toBeUndefined()
  })

  it('ignores revoked and superseded records', async () => {
    await setup()
    await db.update(schema.modules)
      .set({ expiryMode: 'MONTHS', expiryMonths: 12 })
      .where(eq(schema.modules.id, 'TECH-121'))

    await seedRecord({
      userId: 'alice',
      moduleId: 'TECH-121',
      awardedAt: '2025-01-01',
      expiresAt: null,
      revokedAt: new Date(),
      revokedBy: 'tm',
      revokeReason: 'Error',
    })
    await seedRecord({ userId: 'alice', moduleId: 'TECH-121', awardedAt: '2026-06-01', expiresAt: null })

    const plan = await planRecalculation({ academicYearEnd: '09-30' })

    // Only the current record moves; history stays as it was.
    expect(plan.changes).toHaveLength(1)
    expect(plan.changes[0]!.awardedAt).toBe('2026-06-01')
  })

  it('can be scoped to one module', async () => {
    await setup()
    await seedModule('NNT-001', { name: 'Induction', expiryMode: 'ACADEMIC_YEAR' })
    await seedRecord({ userId: 'alice', moduleId: 'NNT-001', awardedAt: '2026-01-15', expiresAt: null })

    const scoped = await planRecalculation({ moduleId: 'NNT-001', academicYearEnd: '09-30' })
    expect(scoped.changes.map(c => c.moduleId)).toEqual(['NNT-001'])
  })
})

describe('POST /api/admin/recalculate', () => {
  it('previews without changing anything', async () => {
    await setup()
    await db.update(schema.modules)
      .set({ expiryMode: 'MONTHS', expiryMonths: 12 })
      .where(eq(schema.modules.id, 'TECH-121'))

    const result = await call(recalculateHandler, adminEvent({})) as { applied: boolean, changes: unknown[] }

    expect(result.applied).toBe(false)
    expect(result.changes).toHaveLength(1)
    const [record] = await db.select().from(schema.records).all()
    expect(record!.expiresAt).toBeNull()
  })

  it('applies when the confirmed count matches, and audits the diff', async () => {
    await setup()
    await db.update(schema.modules)
      .set({ expiryMode: 'MONTHS', expiryMonths: 12 })
      .where(eq(schema.modules.id, 'TECH-121'))

    await call(recalculateHandler, adminEvent({ confirmChangeCount: 1 }))

    const [record] = await db.select().from(schema.records).all()
    expect(record!.expiresAt).toBe('2027-01-15')

    const [entry] = await db.select().from(schema.auditLog).all()
    expect(entry!.action).toBe('record.recalculate')
    expect(JSON.parse(entry!.detail!).changes[0]).toMatchObject({ from: null, to: '2027-01-15' })
  })

  it('refuses a stale confirmation rather than applying it', async () => {
    await setup()
    await db.update(schema.modules)
      .set({ expiryMode: 'MONTHS', expiryMonths: 12 })
      .where(eq(schema.modules.id, 'TECH-121'))

    // The operator previewed 5 changes; only 1 exists now.
    await expect(call(recalculateHandler, adminEvent({ confirmChangeCount: 5 })))
      .rejects.toMatchObject({ statusCode: 409 })

    const [record] = await db.select().from(schema.records).all()
    expect(record!.expiresAt).toBeNull()
  })

  it('is admin-only', async () => {
    await setup()
    const event = makeEvent({ method: 'POST', path: '/api/admin/recalculate', body: {} })
    signIn(event, { id: 'alice' })

    await expect(call(recalculateHandler, event)).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('PUT /api/admin/config', () => {
  function configEvent(body: unknown, userId = 'tm', roles = ['training:ADMIN']) {
    const event = makeEvent({ method: 'PUT', path: '/api/admin/config', body })
    signIn(event, { id: userId, roles })
    return event
  }

  it('stores a valid value and audits the change', async () => {
    await setup()
    await call(configHandler, configEvent({ key: 'notifications_mode', value: 'live' }))

    const row = await db.select().from(schema.siteConfig)
      .where(eq(schema.siteConfig.key, 'notifications_mode')).get()
    expect(row!.value).toBe('live')

    const [entry] = await db.select().from(schema.auditLog).all()
    expect(entry!.action).toBe('config.update')
    expect(JSON.parse(entry!.detail!)).toMatchObject({ from: 'dry-run', to: 'live' })
  })

  it('rejects a malformed academic-year boundary', async () => {
    await setup()
    // A bad value here would quietly move every future induction expiry.
    await expect(call(configHandler, configEvent({ key: 'academic_year_end', value: '31st Sept' })))
      .rejects.toThrow()
  })

  it('rejects a boundary in British day-month order', async () => {
    await setup()
    // 31-08 is MM-DD shaped and stamps 2027-31-08, which no parser accepts
    // and every gate then reads as valid.
    await expect(call(configHandler, configEvent({ key: 'academic_year_end', value: '31-08' })))
      .rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects a boundary on a day that does not exist', async () => {
    await setup()
    await expect(call(configHandler, configEvent({ key: 'academic_year_end', value: '09-31' })))
      .rejects.toMatchObject({ statusCode: 400 })

    // 2001 is not a leap year, so a 29 February boundary goes with them.
    await expect(call(configHandler, configEvent({ key: 'academic_year_end', value: '02-29' })))
      .rejects.toMatchObject({ statusCode: 400 })
  })

  it('accepts a real boundary', async () => {
    await setup()
    await call(configHandler, configEvent({ key: 'academic_year_end', value: '09-30' }))

    const row = await db.select().from(schema.siteConfig)
      .where(eq(schema.siteConfig.key, 'academic_year_end')).get()
    expect(row!.value).toBe('09-30')
  })

  it('rejects an out-of-range warning window', async () => {
    await setup()
    await expect(call(configHandler, configEvent({ key: 'warning_window_days', value: 0 })))
      .rejects.toThrow()
  })

  it('is admin-only', async () => {
    await setup()
    await expect(call(configHandler, configEvent({ key: 'notifications_mode', value: 'live' }, 'alice', [])))
      .rejects.toMatchObject({ statusCode: 403 })
  })
})
