/**
 * The session flow, run through the real handlers: trainer derivation,
 * prerequisite gating and the atomic batch as deployed.
 */

import { describe, it, expect } from 'bun:test'
import createSessionHandler from '../server/api/sessions/index.post'
import checkSessionHandler from '../server/api/sessions/check.post'
import updateSessionHandler from '../server/api/sessions/[id].put'
import { db, schema, countQueries, resetQueryCount } from './mocks/nuxthub-db'
import { addDays } from '../server/utils/validity'
import { today } from '../shared/utils/dates'
import { eq } from 'drizzle-orm'
import { makeEvent, signIn, type FakeEvent } from './setup'
import { seedDepartments, seedLead, seedModule, seedRecord, seedUser } from './helpers/fixtures'

type Handler = (event: FakeEvent) => Promise<unknown>
const call = (handler: unknown, event: FakeEvent) => (handler as Handler)(event)

const TODAY = today()

/** A catalogue with a trainer certification and a prerequisite chain. */
async function setup() {
  await seedDepartments()
  await seedModule('LEAD-CERT', {
    department: 'LEAD',
    kind: 'CERTIFICATION',
    signoffRequired: true,
    grantsTrainer: true,
  })
  await seedModule('NNT-001', { name: 'Induction' })
  await seedModule('TECH-111', { name: 'Rigging' })
  await seedModule('TECH-112', { name: 'Desk' })
  await seedModule('TECH-211', { name: 'Lighting Design' })
  await db.insert(schema.modulePrerequisites).values([
    { moduleId: 'TECH-211', requiresModuleId: 'TECH-111' },
    { moduleId: 'TECH-211', requiresModuleId: 'TECH-112' },
  ])

  await seedUser('trainer', 'A Trainer')
  await seedUser('alice', 'Alice')
  await seedUser('bob', 'Bob')
  await seedUser('member', 'Just A Member')

  // Trainer standing is a record, not a flag (ADR-0004).
  await seedRecord({ userId: 'trainer', moduleId: 'LEAD-CERT', expiresAt: null })
}

function postEvent(body: unknown) {
  return makeEvent({ method: 'POST', path: '/api/sessions', body })
}

const validSession = {
  heldOn: TODAY,
  moduleIds: ['NNT-001'],
  attendeeIds: ['alice', 'bob'],
}

describe('trainer gating', () => {
  it('refuses a member with no trainer certification', async () => {
    await setup()
    const event = postEvent(validSession)
    signIn(event, { id: 'member' })

    await expect(call(createSessionHandler, event)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('allows a holder of a valid trainer certification', async () => {
    await setup()
    const event = postEvent(validSession)
    signIn(event, { id: 'trainer' })

    await call(createSessionHandler, event)
    expect(await db.select().from(schema.sessions).all()).toHaveLength(1)
  })

  it('refuses once that certification has expired', async () => {
    await setup()
    await db.update(schema.records).set({ expiresAt: '2020-09-30' })
      .where(eq(schema.records.userId, 'trainer'))

    const event = postEvent(validSession)
    signIn(event, { id: 'trainer' })

    // No admin action revoked anything: the certification simply lapsed.
    await expect(call(createSessionHandler, event)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('refuses once that certification is revoked', async () => {
    await setup()
    await db.update(schema.records)
      .set({ revokedAt: new Date(), revokedBy: 'alice', revokeReason: 'Granted in error' })
      .where(eq(schema.records.userId, 'trainer'))

    const event = postEvent(validSession)
    signIn(event, { id: 'trainer' })
    await expect(call(createSessionHandler, event)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('allows a department lead who holds no certification', async () => {
    await setup()
    await seedLead('TECH', 'member')

    const event = postEvent(validSession)
    signIn(event, { id: 'member' })

    await call(createSessionHandler, event)
    expect(await db.select().from(schema.sessions).all()).toHaveLength(1)
  })
})

describe('session → records', () => {
  it('creates one record per attendee × module', async () => {
    await setup()
    const event = postEvent({
      heldOn: TODAY,
      moduleIds: ['NNT-001', 'TECH-111'],
      attendeeIds: ['alice', 'bob'],
    })
    signIn(event, { id: 'trainer' })

    const result = await call(createSessionHandler, event) as { recordCount: number }
    expect(result.recordCount).toBe(4)

    const records = await db.select().from(schema.records)
      .where(eq(schema.records.source, 'SESSION')).all()
    expect(records).toHaveLength(4)
    expect(records.every(r => r.sessionId !== null)).toBe(true)
    expect(records.every(r => r.awardedAt === TODAY)).toBe(true)
  })

  it('writes the session, its junctions and its records together', async () => {
    await setup()
    const event = postEvent(validSession)
    signIn(event, { id: 'trainer' })
    await call(createSessionHandler, event)

    const [session] = await db.select().from(schema.sessions).all()
    expect(session!.trainerUserId).toBe('trainer')
    expect(await db.select().from(schema.sessionModules).all()).toHaveLength(1)
    expect(await db.select().from(schema.sessionAttendees).all()).toHaveLength(2)
  })

  it('writes nothing at all when the batch fails', async () => {
    await setup()
    // Same attendee twice violates the unique (session, user) index, which
    // fails the whole batch: the atomicity ADR-0009 exists for.
    const event = postEvent({ ...validSession, attendeeIds: ['alice', 'alice'] })
    signIn(event, { id: 'trainer' })

    await expect(call(createSessionHandler, event)).rejects.toThrow()

    expect(await db.select().from(schema.sessions).all()).toHaveLength(0)
    expect(await db.select().from(schema.records).where(eq(schema.records.source, 'SESSION')).all()).toHaveLength(0)
  })

  it('refuses a session with no attendees, it would record nothing', async () => {
    await setup()
    const event = postEvent({ ...validSession, attendeeIds: [] })
    signIn(event, { id: 'trainer' })

    await expect(call(createSessionHandler, event)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('refuses to hand out a certification in a session', async () => {
    await setup()
    const event = postEvent({ ...validSession, moduleIds: ['LEAD-CERT'] })
    signIn(event, { id: 'trainer' })

    await expect(call(createSessionHandler, event)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('refuses a retired module', async () => {
    await setup()
    await db.update(schema.modules).set({ status: 'RETIRED' })
      .where(eq(schema.modules.id, 'NNT-001'))

    const event = postEvent(validSession)
    signIn(event, { id: 'trainer' })
    await expect(call(createSessionHandler, event)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('refuses to record training that has not happened yet', async () => {
    await setup()
    // Derived in London, not UTC: during BST the UTC day-after is still today
    // here, so a UTC-based tomorrow is a date the schema rightly accepts.
    const tomorrow = addDays(today(), 1)
    const event = postEvent({ ...validSession, heldOn: tomorrow })
    signIn(event, { id: 'trainer' })

    await expect(call(createSessionHandler, event)).rejects.toThrow()
  })
})

describe('prerequisites in the session flow', () => {
  it('warns but does not block on an ordinary module', async () => {
    await setup()
    const event = postEvent({ ...validSession, moduleIds: ['TECH-211'] })
    signIn(event, { id: 'trainer' })

    // Neither attendee holds TECH-111/112.
    await expect(call(createSessionHandler, event)).rejects.toMatchObject({ statusCode: 409 })

    const acknowledged = postEvent({
      ...validSession,
      moduleIds: ['TECH-211'],
      acknowledgeWarnings: true,
    })
    signIn(acknowledged, { id: 'trainer' })
    await call(createSessionHandler, acknowledged)

    expect(await db.select().from(schema.records).where(eq(schema.records.moduleId, 'TECH-211')).all())
      .toHaveLength(2)
  })

  it('blocks outright on a safety-critical module, acknowledged or not', async () => {
    await setup()
    await db.update(schema.modules).set({ safetyCritical: true })
      .where(eq(schema.modules.id, 'TECH-211'))

    const event = postEvent({
      ...validSession,
      moduleIds: ['TECH-211'],
      acknowledgeWarnings: true,
    })
    signIn(event, { id: 'trainer' })

    await expect(call(createSessionHandler, event)).rejects.toMatchObject({ statusCode: 422 })
    expect(await db.select().from(schema.sessions).all()).toHaveLength(0)
  })

  it('is satisfied by held prerequisites', async () => {
    await setup()
    for (const userId of ['alice', 'bob']) {
      await seedRecord({ userId, moduleId: 'TECH-111', expiresAt: null })
      await seedRecord({ userId, moduleId: 'TECH-112', expiresAt: null })
    }

    const event = postEvent({ ...validSession, moduleIds: ['TECH-211'] })
    signIn(event, { id: 'trainer' })

    const result = await call(createSessionHandler, event) as { warnings: unknown[] }
    expect(result.warnings).toEqual([])
  })
})

describe('POST /api/sessions/check', () => {
  it('previews exactly the records that would be created, writing nothing', async () => {
    await setup()
    const event = makeEvent({
      method: 'POST',
      path: '/api/sessions/check',
      body: { heldOn: TODAY, moduleIds: ['NNT-001', 'TECH-111'], attendeeIds: ['alice', 'bob'] },
    })
    signIn(event, { id: 'trainer' })

    const preview = await call(checkSessionHandler, event) as { recordCount: number, records: unknown[] }
    expect(preview.recordCount).toBe(4)
    expect(preview.records).toHaveLength(4)

    expect(await db.select().from(schema.sessions).all()).toHaveLength(0)
  })
})

describe('prerequisite checking at cohort size', () => {
  it('costs a fixed number of queries however many attendees there are', async () => {
    await setup()
    // TECH-211 already requires TECH-111 and TECH-112, which nobody here holds.
    const cohort: string[] = []
    for (let i = 0; i < 40; i++) {
      await seedUser(`member-${i}`, `Member ${i}`)
      cohort.push(`member-${i}`)
    }

    const event = makeEvent({
      method: 'POST',
      path: '/api/sessions/check',
      body: { heldOn: TODAY, moduleIds: ['TECH-211'], attendeeIds: cohort },
    })
    signIn(event, { id: 'trainer' })

    resetQueryCount()
    const result = await call(checkSessionHandler, event) as { warnings: unknown[] }
    const used = countQueries()

    // Everyone lacks TECH-111, so the answer must still be per-person.
    expect(result.warnings).toHaveLength(40)
    // Per-pair checking made this 40+ queries; it must not scale with cohort.
    expect(used).toBeLessThan(15)
  })
})

describe('editing a session', () => {
  async function logSession() {
    const event = postEvent(validSession)
    signIn(event, { id: 'trainer' })
    const { id } = await call(createSessionHandler, event) as { id: string }
    return id
  }

  it('re-derives records, revoking the old ones rather than deleting them', async () => {
    await setup()
    const id = await logSession()

    const edit = makeEvent({
      method: 'PUT',
      path: `/api/sessions/${id}`,
      params: { id },
      body: { ...validSession, attendeeIds: ['alice'] },
    })
    signIn(edit, { id: 'trainer' })
    await call(updateSessionHandler, edit)

    const records = await db.select().from(schema.records)
      .where(eq(schema.records.sessionId, id)).all()

    // Two revoked (the original pair) plus one fresh for Alice.
    expect(records.filter(r => r.revokedAt !== null)).toHaveLength(2)
    expect(records.filter(r => r.revokedAt === null)).toHaveLength(1)
    expect(records.filter(r => r.revokedAt === null)[0]!.userId).toBe('alice')
    expect(records.every(r => r.revokedAt === null || r.revokeReason === 'Session edited')).toBe(true)
  })

  it('refuses to introduce a certification through an edit', async () => {
    await setup()
    const id = await logSession()

    const edit = makeEvent({
      method: 'PUT',
      path: `/api/sessions/${id}`,
      params: { id },
      body: { ...validSession, moduleIds: ['LEAD-CERT'] },
    })
    signIn(edit, { id: 'trainer' })

    await expect(call(updateSessionHandler, edit)).rejects.toMatchObject({ statusCode: 400 })

    // No LEAD-CERT record, so no trainer standing was conferred.
    const granted = await db.select().from(schema.records)
      .where(eq(schema.records.moduleId, 'LEAD-CERT')).all()
    expect(granted.filter(r => r.sessionId === id)).toHaveLength(0)
  })

  it('refuses to introduce a retired module through an edit', async () => {
    await setup()
    const id = await logSession()
    await db.update(schema.modules).set({ status: 'RETIRED' })
      .where(eq(schema.modules.id, 'NNT-001'))

    const edit = makeEvent({
      method: 'PUT',
      path: `/api/sessions/${id}`,
      params: { id },
      body: { ...validSession },
    })
    signIn(edit, { id: 'trainer' })

    await expect(call(updateSessionHandler, edit)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('refuses an admin with a stale session editing someone else’s', async () => {
    await setup()
    const id = await logSession()

    const edit = makeEvent({
      method: 'PUT',
      path: `/api/sessions/${id}`,
      params: { id },
      body: { ...validSession, attendeeIds: ['alice'] },
    })
    signIn(edit, { id: 'tm', roles: ['training:ADMIN'] }, { refreshedAt: Date.now() - 20 * 60_000 })

    await expect(call(updateSessionHandler, edit)).rejects.toMatchObject({
      statusCode: 401,
      data: { stale: true },
    })
  })

  it('refuses a trainer editing someone else’s session', async () => {
    await setup()
    await seedUser('other-trainer', 'Other')
    await seedRecord({ userId: 'other-trainer', moduleId: 'LEAD-CERT', expiresAt: null })
    const id = await logSession()

    const edit = makeEvent({
      method: 'PUT',
      path: `/api/sessions/${id}`,
      params: { id },
      body: validSession,
    })
    signIn(edit, { id: 'other-trainer' })

    await expect(call(updateSessionHandler, edit)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('measures the window from delivery, not from the day it went in the diary', async () => {
    await setup()
    const id = await logSession()

    // Scheduled six weeks ahead and taught today: a scheduled session and a
    // delivered one are the same row (ADR-0013).
    await db.update(schema.sessions)
      .set({ createdAt: new Date(Date.now() - 44 * 86_400_000), deliveredAt: new Date() })
      .where(eq(schema.sessions.id, id))

    const edit = makeEvent({
      method: 'PUT',
      path: `/api/sessions/${id}`,
      params: { id },
      body: { ...validSession, attendeeIds: ['alice'] },
    })
    signIn(edit, { id: 'trainer' })

    await expect(call(updateSessionHandler, edit)).resolves.toMatchObject({ recordsCreated: 1 })
  })

  it('refuses once the window since delivery has passed', async () => {
    await setup()
    const id = await logSession()

    await db.update(schema.sessions)
      .set({ createdAt: new Date(), deliveredAt: new Date(Date.now() - 20 * 86_400_000) })
      .where(eq(schema.sessions.id, id))

    const edit = makeEvent({
      method: 'PUT',
      path: `/api/sessions/${id}`,
      params: { id },
      body: validSession,
    })
    signIn(edit, { id: 'trainer' })

    await expect(call(updateSessionHandler, edit)).rejects.toMatchObject({ statusCode: 409 })
  })

  it('refuses once the edit window has passed', async () => {
    await setup()
    const id = await logSession()

    // Age the session past the 14-day default.
    await db.update(schema.sessions)
      .set({ createdAt: new Date(Date.now() - 20 * 86_400_000) })
      .where(eq(schema.sessions.id, id))

    const edit = makeEvent({
      method: 'PUT',
      path: `/api/sessions/${id}`,
      params: { id },
      body: validSession,
    })
    signIn(edit, { id: 'trainer' })

    await expect(call(updateSessionHandler, edit)).rejects.toMatchObject({ statusCode: 409 })
  })
})

describe('audit trail', () => {
  it('records the session and any acknowledged warnings', async () => {
    await setup()
    const event = postEvent({ ...validSession, moduleIds: ['TECH-211'], acknowledgeWarnings: true })
    signIn(event, { id: 'trainer' })
    await call(createSessionHandler, event)

    const [entry] = await db.select().from(schema.auditLog).all()
    expect(entry!.action).toBe('session.create')
    expect(entry!.actorUserId).toBe('trainer')

    const detail = JSON.parse(entry!.detail!)
    expect(detail.recordsCreated).toBe(2)
    // The warnings the trainer confirmed past are part of the evidence.
    expect(detail.acknowledgedWarnings).toHaveLength(2)
  })
})
