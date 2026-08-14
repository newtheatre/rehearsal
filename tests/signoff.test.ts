/**
 * Certification sign-off, external certificates and revocation.
 *
 * Phase 2's other acceptance criterion: "a cert sign-off hard-blocks on an
 * unmet prerequisite". The block is server-side, whatever the UI offered
 * (CLAUDE.md invariant 5).
 */

import { describe, it, expect } from 'vitest'
import signoffHandler from '../server/api/people/[id]/signoff.post'
import externalHandler from '../server/api/people/[id]/external.post'
import revokeHandler from '../server/api/records/[id]/revoke.post'
import { db, schema } from './mocks/nuxthub-db'
import { eq } from 'drizzle-orm'
import { makeEvent, signIn, type FakeEvent } from './setup'
import { seedDepartments, seedLead, seedModule, seedRecord, seedUser } from './helpers/fixtures'
import { currentRecordsFor } from '../server/utils/records'

type Handler = (event: FakeEvent) => Promise<unknown>
const call = (handler: unknown, event: FakeEvent) => (handler as Handler)(event)

const TODAY = new Date().toISOString().slice(0, 10)

async function setup() {
  await seedDepartments()
  await seedModule('TECH-111', { name: 'Rigging' })
  await seedModule('TECH-112', { name: 'Desk' })
  await seedModule('LD-CERT', {
    department: 'TECH',
    kind: 'CERTIFICATION',
    name: 'Lighting Designer',
    signoffRequired: true,
    grantsSupervisor: true,
  })
  await seedModule('SM-CERT', {
    department: 'STGE',
    kind: 'CERTIFICATION',
    name: 'Stage Manager',
    signoffRequired: true,
  })
  await seedModule('SFTY-101', { department: 'NNT', name: 'First Aid', expiryMode: 'MONTHS', expiryMonths: 36 })
  await db.insert(schema.modulePrerequisites).values([
    { moduleId: 'LD-CERT', requiresModuleId: 'TECH-111' },
    { moduleId: 'LD-CERT', requiresModuleId: 'TECH-112' },
  ])

  await seedUser('alice', 'Alice')
  await seedUser('ctd', 'The CTD')
  await seedUser('tm', 'Theatre Manager')
  await seedUser('member', 'A Member')
  await seedLead('TECH', 'ctd')
}

function signoffEvent(userId: string, body: unknown) {
  return makeEvent({
    method: 'POST',
    path: `/api/people/${userId}/signoff`,
    params: { id: userId },
    body,
  })
}

describe('certification sign-off', () => {
  it('blocks when a prerequisite was never held', async () => {
    await setup()
    const event = signoffEvent('alice', { moduleId: 'LD-CERT', awardedAt: TODAY })
    signIn(event, { id: 'ctd' })

    await expect(call(signoffHandler, event)).rejects.toMatchObject({ statusCode: 422 })
    expect(await db.select().from(schema.records).all()).toHaveLength(0)
  })

  it('blocks when a prerequisite has expired', async () => {
    await setup()
    await seedRecord({ userId: 'alice', moduleId: 'TECH-111', expiresAt: null })
    await seedRecord({ userId: 'alice', moduleId: 'TECH-112', expiresAt: '2020-01-01' })

    const event = signoffEvent('alice', { moduleId: 'LD-CERT', awardedAt: TODAY })
    signIn(event, { id: 'ctd' })

    await expect(call(signoffHandler, event)).rejects.toMatchObject({ statusCode: 422 })
  })

  it('blocks when a prerequisite has been revoked', async () => {
    await setup()
    await seedRecord({ userId: 'alice', moduleId: 'TECH-111', expiresAt: null })
    await seedRecord({
      userId: 'alice',
      moduleId: 'TECH-112',
      expiresAt: null,
      revokedAt: new Date(),
      revokedBy: 'tm',
      revokeReason: 'Wrong person',
    })

    const event = signoffEvent('alice', { moduleId: 'LD-CERT', awardedAt: TODAY })
    signIn(event, { id: 'ctd' })
    await expect(call(signoffHandler, event)).rejects.toMatchObject({ statusCode: 422 })
  })

  it('names what is missing, so the lead can act on it', async () => {
    await setup()
    await seedRecord({ userId: 'alice', moduleId: 'TECH-111', expiresAt: null })

    const event = signoffEvent('alice', { moduleId: 'LD-CERT', awardedAt: TODAY })
    signIn(event, { id: 'ctd' })

    await expect(call(signoffHandler, event)).rejects.toMatchObject({
      statusMessage: expect.stringContaining('TECH-112'),
    })
  })

  it('succeeds when every prerequisite is held', async () => {
    await setup()
    await seedRecord({ userId: 'alice', moduleId: 'TECH-111', expiresAt: null })
    await seedRecord({ userId: 'alice', moduleId: 'TECH-112', expiresAt: null })

    const event = signoffEvent('alice', { moduleId: 'LD-CERT', awardedAt: TODAY })
    signIn(event, { id: 'ctd' })
    await call(signoffHandler, event)

    const [record] = await db.select().from(schema.records)
      .where(eq(schema.records.moduleId, 'LD-CERT')).all()
    expect(record!.source).toBe('SIGNOFF')
    expect(record!.grantedBy).toBe('ctd')
  })

  it('accepts a prerequisite that is merely EXPIRING', async () => {
    await setup()
    const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10)
    await seedRecord({ userId: 'alice', moduleId: 'TECH-111', expiresAt: soon })
    await seedRecord({ userId: 'alice', moduleId: 'TECH-112', expiresAt: null })

    const event = signoffEvent('alice', { moduleId: 'LD-CERT', awardedAt: TODAY })
    signIn(event, { id: 'ctd' })
    await call(signoffHandler, event)

    expect(await db.select().from(schema.records).where(eq(schema.records.moduleId, 'LD-CERT')).all())
      .toHaveLength(1)
  })
})

describe('sign-off authority', () => {
  it('refuses an ordinary member', async () => {
    await setup()
    await seedRecord({ userId: 'alice', moduleId: 'TECH-111', expiresAt: null })
    await seedRecord({ userId: 'alice', moduleId: 'TECH-112', expiresAt: null })

    const event = signoffEvent('alice', { moduleId: 'LD-CERT', awardedAt: TODAY })
    signIn(event, { id: 'member' })

    await expect(call(signoffHandler, event)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('refuses a lead signing off another department’s certification', async () => {
    await setup()
    const event = signoffEvent('alice', { moduleId: 'SM-CERT', awardedAt: TODAY })
    signIn(event, { id: 'ctd' })

    // The CTD leads TECH; SM-CERT belongs to stage management.
    await expect(call(signoffHandler, event)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('allows an admin in any department', async () => {
    await setup()
    const event = signoffEvent('alice', { moduleId: 'SM-CERT', awardedAt: TODAY })
    signIn(event, { id: 'tm', roles: ['training:ADMIN'] })

    await call(signoffHandler, event)
    expect(await db.select().from(schema.records).where(eq(schema.records.moduleId, 'SM-CERT')).all())
      .toHaveLength(1)
  })

  it('refuses to sign off something that is not a certification', async () => {
    await setup()
    const event = signoffEvent('alice', { moduleId: 'TECH-111', awardedAt: TODAY })
    signIn(event, { id: 'ctd' })

    await expect(call(signoffHandler, event)).rejects.toMatchObject({ statusCode: 400 })
  })
})

describe('external certificates', () => {
  it('stamps the certificate\'s own expiry, overriding module config', async () => {
    await setup()
    const event = makeEvent({
      method: 'POST',
      path: '/api/people/alice/external',
      params: { id: 'alice' },
      body: {
        moduleId: 'SFTY-101',
        awardedAt: '2026-08-01',
        expiresAt: '2028-03-03',
        externalRef: 'SU EFAW certificate',
      },
    })
    signIn(event, { id: 'tm', roles: ['training:ADMIN'] })
    await call(externalHandler, event)

    const [record] = await db.select().from(schema.records)
      .where(eq(schema.records.moduleId, 'SFTY-101')).all()

    // Module config says 36 months (→ 2029-08-01); the certificate wins.
    expect(record!.expiresAt).toBe('2028-03-03')
    expect(record!.source).toBe('EXTERNAL')
    expect(record!.externalRef).toBe('SU EFAW certificate')
  })

  it('falls back to module config when no certificate date is given', async () => {
    await setup()
    const event = makeEvent({
      method: 'POST',
      path: '/api/people/alice/external',
      params: { id: 'alice' },
      body: { moduleId: 'SFTY-101', awardedAt: '2026-08-01', externalRef: 'Card seen, undated' },
    })
    signIn(event, { id: 'tm', roles: ['training:ADMIN'] })
    await call(externalHandler, event)

    const [record] = await db.select().from(schema.records).all()
    expect(record!.expiresAt).toBe('2029-08-01')
  })

  it('rejects a certificate that expires before it was awarded', async () => {
    await setup()
    const event = makeEvent({
      method: 'POST',
      path: '/api/people/alice/external',
      params: { id: 'alice' },
      body: {
        moduleId: 'SFTY-101',
        awardedAt: '2026-08-01',
        expiresAt: '2026-07-01',
        externalRef: 'Typo',
      },
    })
    signIn(event, { id: 'tm', roles: ['training:ADMIN'] })
    await expect(call(externalHandler, event)).rejects.toMatchObject({ statusCode: 400 })
  })
})

describe('revocation', () => {
  async function seedSignedOff() {
    await setup()
    await seedRecord({ userId: 'alice', moduleId: 'TECH-111', expiresAt: null })
    const [record] = await db.select().from(schema.records).all()
    return record!
  }

  function revokeEvent(id: string, body: unknown) {
    return makeEvent({ method: 'POST', path: `/api/records/${id}/revoke`, params: { id }, body })
  }

  it('is admin-only — a department lead cannot revoke', async () => {
    const record = await seedSignedOff()
    const event = revokeEvent(record.id, { reason: 'Mistaken' })
    signIn(event, { id: 'ctd' })

    await expect(call(revokeHandler, event)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('demands a reason', async () => {
    const record = await seedSignedOff()
    const event = revokeEvent(record.id, { reason: '' })
    signIn(event, { id: 'tm', roles: ['training:ADMIN'] })

    await expect(call(revokeHandler, event)).rejects.toThrow()
  })

  it('withdraws the record without deleting it', async () => {
    const record = await seedSignedOff()
    const event = revokeEvent(record.id, { reason: 'Logged against the wrong person' })
    signIn(event, { id: 'tm', roles: ['training:ADMIN'] })
    await call(revokeHandler, event)

    const [row] = await db.select().from(schema.records).all()
    expect(row!.revokedAt).not.toBeNull()
    expect(row!.revokeReason).toBe('Logged against the wrong person')

    // Gone from current standing, still present as history.
    expect(await currentRecordsFor('alice')).toHaveLength(0)
    expect(await db.select().from(schema.records).all()).toHaveLength(1)
  })

  it('is idempotent when two admins reach the same conclusion', async () => {
    const record = await seedSignedOff()
    for (const _ of [1, 2]) {
      const event = revokeEvent(record.id, { reason: 'Mistaken' })
      signIn(event, { id: 'tm', roles: ['training:ADMIN'] })
      await call(revokeHandler, event)
    }

    const entries = await db.select().from(schema.auditLog).all()
    expect(entries.filter(e => e.action === 'record.revoke')).toHaveLength(1)
  })
})
