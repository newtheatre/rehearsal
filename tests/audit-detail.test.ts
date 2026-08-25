/**
 * What a mutation may put in `audit_log.detail`. The erasure hook cannot reach
 * this table, so anything identifying written here outlives the erasure.
 */

import { describe, it, expect } from 'bun:test'
import { db, schema } from './mocks/nuxthub-db'
import { eq } from 'drizzle-orm'
import { makeEvent, signIn, type FakeEvent } from './setup'
import { seedDepartments, seedLead, seedModule, seedRecord, seedUser } from './helpers/fixtures'
import { today } from '../shared/utils/dates'
import revokeHandler from '../server/api/records/[id]/revoke.post'
import signoffHandler from '../server/api/people/[id]/signoff.post'
import externalHandler from '../server/api/people/[id]/external.post'
import grantHandler from '../server/api/practice-windows/index.post'
import declineHandler from '../server/api/module-requests/[id]/decline.post'
import addLeadHandler from '../server/api/admin/leads/index.post'
import anonymiseHandler from '../server/api/_hooks/auth/anonymise.post'
import { createHash } from 'node:crypto'
import { runtimeConfig } from './setup'

type Handler = (event: FakeEvent) => Promise<unknown>
const call = (handler: unknown, event: FakeEvent) => (handler as Handler)(event)

const SERVICE_TOKEN = 'nnt_svc_audit-token'

/** The kind of sentence a lead actually types about a person. */
const PROSE = 'Suspended after the safeguarding panel, see JS report'

async function setup() {
  runtimeConfig.authServiceToken = SERVICE_TOKEN
  await seedDepartments()
  await seedUser('tm', 'Theatre Manager')
  await seedUser('ctd', 'The CTD')
  await seedUser('alice', 'Alice Anderson')
  await seedLead('TECH', 'ctd')

  await seedModule('TECH-111', { name: 'Rigging', allowsExternal: true })
  await seedModule('LD-CERT', {
    department: 'TECH',
    kind: 'CERTIFICATION',
    name: 'Lighting Designer',
    signoffRequired: true,
  })

  await db.insert(schema.practiceTargets).values({
    key: 'bar-till', name: 'Bar till', moduleIds: ['TECH-111'],
  })
}

function leadEvent(overrides: Partial<FakeEvent> = {}) {
  const event = makeEvent({ method: 'POST', path: '/x', ...overrides })
  signIn(event, { id: 'ctd' })
  return event
}

function adminEvent(overrides: Partial<FakeEvent> = {}) {
  const event = makeEvent({ method: 'POST', path: '/x', ...overrides })
  signIn(event, { id: 'tm', roles: ['training:ADMIN'] })
  return event
}

async function detailsFor(action: string): Promise<string[]> {
  const rows = await db.select().from(schema.auditLog)
    .where(eq(schema.auditLog.action, action)).all()
  return rows.map(row => row.detail ?? '')
}

describe('free text about a person never reaches the audit detail', () => {
  it('keeps a revoke reason out of it', async () => {
    await setup()
    await seedRecord({ userId: 'alice', moduleId: 'TECH-111', expiresAt: null })
    const record = await db.select().from(schema.records).get()

    await call(revokeHandler, adminEvent({ params: { id: record!.id }, body: { reason: PROSE } }))

    const [detail] = await detailsFor('record.revoke')
    expect(detail).not.toContain('safeguarding')
    // The reason itself is kept where the erasure hook can reach it.
    const revoked = await db.select().from(schema.records).get()
    expect(revoked!.revokeReason).toBe(PROSE)
  })

  it('keeps a sign-off note out of it', async () => {
    await setup()
    await call(signoffHandler, leadEvent({
      params: { id: 'alice' },
      body: { moduleId: 'LD-CERT', awardedAt: today(), note: PROSE },
    }))

    const [detail] = await detailsFor('record.signoff')
    expect(detail).not.toContain('safeguarding')
    expect(detail).toContain('LD-CERT')
  })

  it('keeps a certificate reference out of it', async () => {
    await setup()
    await call(externalHandler, leadEvent({
      params: { id: 'alice' },
      body: { moduleId: 'TECH-111', awardedAt: today(), externalRef: PROSE },
    }))

    const [detail] = await detailsFor('record.external')
    expect(detail).not.toContain('safeguarding')
  })

  it('keeps an ad-hoc practice reason out of it', async () => {
    await setup()
    await call(grantHandler, leadEvent({
      body: { userId: 'alice', targetKey: 'bar-till', hours: 4, reason: PROSE },
    }))

    const [detail] = await detailsFor('practice-window.grant')
    expect(detail).not.toContain('safeguarding')
    expect(detail).toContain('bar-till')
  })

  it('keeps a declined request reason out of it', async () => {
    await setup()
    const [request] = await db.insert(schema.moduleRequests)
      .values({ userId: 'alice', moduleId: 'TECH-111' }).returning()

    await call(declineHandler, leadEvent({ params: { id: request!.id }, body: { reason: PROSE } }))

    const [detail] = await detailsFor('request.decline')
    expect(detail).not.toContain('safeguarding')
  })

  it('keeps a real name out of it, since the view resolves names at read time', async () => {
    await setup()
    await call(addLeadHandler, adminEvent({ body: { department: 'STGE', userId: 'alice' } }))

    const [detail] = await detailsFor('lead.add')
    expect(detail).not.toContain('Alice Anderson')
    expect(detail).toContain('alice')
  })

  it('leaves nothing an erasure cannot reach', async () => {
    await setup()
    await seedRecord({ userId: 'alice', moduleId: 'TECH-111', expiresAt: null })
    const record = await db.select().from(schema.records).get()
    await call(revokeHandler, adminEvent({ params: { id: record!.id }, body: { reason: PROSE } }))
    await call(grantHandler, leadEvent({
      body: { userId: 'alice', targetKey: 'bar-till', hours: 4, reason: PROSE },
    }))

    await call(anonymiseHandler, makeEvent({
      method: 'POST',
      path: '/api/_hooks/auth/anonymise',
      headers: { authorization: `Bearer ${createHash('sha256').update(SERVICE_TOKEN).digest('hex')}` },
      body: { userId: 'alice' },
    }))

    // The whole point: after erasure no audit row can be searched back to her.
    const rows = await db.select().from(schema.auditLog).all()
    expect(rows.every(row => !(row.detail ?? '').includes('safeguarding'))).toBe(true)
    expect(rows.every(row => !(row.detail ?? '').includes('Alice Anderson'))).toBe(true)
  })
})
