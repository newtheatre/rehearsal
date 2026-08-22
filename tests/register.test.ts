/**
 * Marking the register, which is the only thing that awards a record
 * (ADR-0013). The absence tests are the point of the feature.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const sent: { to: string, subject: string }[] = []

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
const { makeEvent, signIn } = await import('./setup')
type FakeEvent = import('./setup').FakeEvent
const { seedDepartments, seedModule, seedRecord, seedUser } = await import('./helpers/fixtures')
const { eq, and } = await import('drizzle-orm')

const scheduleHandler = (await import('../server/api/sessions/schedule.post')).default
const signupHandler = (await import('../server/api/sessions/[id]/signup.post')).default
const withdrawHandler = (await import('../server/api/sessions/[id]/signup.delete')).default
const openRegisterHandler = (await import('../server/api/sessions/[id]/register/open.post')).default
const markHandler = (await import('../server/api/sessions/[id]/register/index.post')).default
const readRegisterHandler = (await import('../server/api/sessions/[id]/register/index.get')).default
const addAttendeeHandler = (await import('../server/api/sessions/[id]/attendees.post')).default
const logHandler = (await import('../server/api/sessions/index.get')).default

type Handler = (event: FakeEvent) => Promise<unknown>
const call = (handler: unknown, event: FakeEvent) => (handler as Handler)(event)

const TODAY = new Date().toISOString().slice(0, 10)

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
  await seedModule('STGE-201', { name: 'Fly floor', safetyCritical: true })
  await db.insert(schema.modulePrerequisites).values([
    { moduleId: 'STGE-201', requiresModuleId: 'TECH-111' },
    { moduleId: 'TECH-112', requiresModuleId: 'NNT-001' },
  ])

  await seedUser('trainer', 'A Trainer')
  await seedUser('alice', 'Alice Adams')
  await seedUser('bob', 'Bob Barnes')
  await seedUser('cara', 'Cara Cole')
  await seedRecord({ userId: 'trainer', moduleId: 'LEAD-CERT', expiresAt: null })
}

/** A session today, open, with the named people signed up. */
async function sessionWith(users: string[], moduleIds = ['NNT-001'], capacity: number | null = null) {
  const create = makeEvent({ method: 'POST', path: '/api/sessions/schedule', body: {
    heldOn: TODAY,
    moduleIds,
    capacity,
    openNow: true,
  } })
  signIn(create, { id: 'trainer' })
  const { id } = await call(scheduleHandler, create) as { id: string }

  for (const user of users) {
    const event = makeEvent({ method: 'POST', path: '/x', params: { id } })
    signIn(event, { id: user })
    await call(signupHandler, event)
  }
  return id
}

async function leadAdds(id: string, userId: string) {
  const event = makeEvent({ method: 'POST', path: '/x', params: { id }, body: { userId } })
  signIn(event, { id: 'trainer' })
  return call(addAttendeeHandler, event)
}

async function openTheRegister(id: string) {
  const event = makeEvent({ method: 'POST', path: '/x', params: { id } })
  signIn(event, { id: 'trainer' })
  return call(openRegisterHandler, event)
}

async function mark(id: string, marks: { userId: string, present: boolean }[], extra: Record<string, unknown> = {}) {
  const event = makeEvent({ method: 'POST', path: '/x', params: { id }, body: { marks, ...extra } })
  signIn(event, { id: 'trainer' })
  return call(markHandler, event) as Promise<{
    recordCount: number
    present: number
    absent: number
    toldAbsentees: number
  }>
}

async function recordsFor(userId: string) {
  return db.select().from(schema.records)
    .where(and(eq(schema.records.userId, userId), eq(schema.records.source, 'SESSION')))
    .all()
}

beforeEach(async () => {
  sent.length = 0
  await setup()
})

describe('attendance is what awards', () => {
  it('creates records for the people present and none for the absent', async () => {
    const id = await sessionWith(['alice', 'bob'])
    await openTheRegister(id)

    const result = await mark(id, [
      { userId: 'alice', present: true },
      { userId: 'bob', present: false },
    ])

    expect(result.recordCount).toBe(1)
    expect(await recordsFor('alice')).toHaveLength(1)
    expect(await recordsFor('bob')).toHaveLength(0)
  })

  it('emails the absent, and only the absent', async () => {
    const id = await sessionWith(['alice', 'bob'])
    await openTheRegister(id)
    sent.length = 0

    await mark(id, [
      { userId: 'alice', present: true },
      { userId: 'bob', present: false },
    ])

    expect(sent).toHaveLength(1)
    expect(sent[0]!.to).toBe('bob@dev.newtheatre.org.uk')
    expect(sent[0]!.subject).toContain('Sorry we missed you')
  })

  it('leaves an absentee unable to be signed off on a module needing it', async () => {
    const id = await sessionWith(['alice', 'bob'], ['TECH-111'])
    await openTheRegister(id)
    await mark(id, [
      { userId: 'alice', present: true },
      { userId: 'bob', present: false },
    ])

    // STGE-201 needs TECH-111, which only Alice now holds. Bob cannot sign up,
    // and a lead adding him anyway still cannot award him.
    const second = await sessionWith(['alice'], ['STGE-201'])
    await leadAdds(second, 'bob')
    await openTheRegister(second)
    await expect(mark(second, [
      { userId: 'alice', present: true },
      { userId: 'bob', present: true },
    ])).rejects.toMatchObject({ statusCode: 422 })
  })

  it('marks the attendee rows so the reason is visible afterwards', async () => {
    const id = await sessionWith(['alice', 'bob'])
    await openTheRegister(id)
    await mark(id, [
      { userId: 'alice', present: true },
      { userId: 'bob', present: false },
    ])

    const rows = await db.select().from(schema.sessionAttendees)
      .where(eq(schema.sessionAttendees.sessionId, id)).all()

    expect(rows.find(row => row.userId === 'alice')!.status).toBe('ATTENDED')
    expect(rows.find(row => row.userId === 'bob')!.status).toBe('ABSENT')
    expect(rows.every(row => row.markedByUserId === 'trainer')).toBe(true)
  })

  it('awards a waitlisted person who turned up and was marked present', async () => {
    const id = await sessionWith(['alice', 'bob'], ['NNT-001'], 1)
    await openTheRegister(id)

    await mark(id, [
      { userId: 'alice', present: true },
      { userId: 'bob', present: true },
    ])

    // The waitlist decides who to expect, not who was taught.
    expect(await recordsFor('bob')).toHaveLength(1)
  })

  it('puts the session in the delivery log once marked', async () => {
    const id = await sessionWith(['alice'])
    await openTheRegister(id)
    await mark(id, [{ userId: 'alice', present: true }])

    const event = makeEvent({ method: 'GET', path: '/api/sessions', query: {} })
    signIn(event, { id: 'alice' })
    const log = await call(logHandler, event) as { sessions: { id: string, attendeeCount: number }[] }

    const entry = log.sessions.find(session => session.id === id)
    expect(entry).toBeDefined()
    expect(entry!.attendeeCount).toBe(1)
  })

  it('counts only those present in the log', async () => {
    const id = await sessionWith(['alice', 'bob'])
    await openTheRegister(id)
    await mark(id, [
      { userId: 'alice', present: true },
      { userId: 'bob', present: false },
    ])

    const event = makeEvent({ method: 'GET', path: '/api/sessions', query: {} })
    signIn(event, { id: 'alice' })
    const log = await call(logHandler, event) as { sessions: { id: string, attendeeCount: number }[] }

    expect(log.sessions.find(session => session.id === id)!.attendeeCount).toBe(1)
  })
})

describe('a register is marked once', () => {
  it('refuses a second submission and awards nothing twice', async () => {
    const id = await sessionWith(['alice'])
    await openTheRegister(id)
    await mark(id, [{ userId: 'alice', present: true }])

    await expect(mark(id, [{ userId: 'alice', present: true }]))
      .rejects.toMatchObject({ statusCode: 409 })

    expect(await recordsFor('alice')).toHaveLength(1)
  })

  it('refuses somebody who is not on the register', async () => {
    const id = await sessionWith(['alice'])
    await openTheRegister(id)

    await expect(mark(id, [
      { userId: 'alice', present: true },
      { userId: 'cara', present: true },
    ])).rejects.toMatchObject({ statusCode: 409 })
  })

  it('refuses somebody who withdrew before the register was marked', async () => {
    const id = await sessionWith(['alice', 'bob'])
    const leave = makeEvent({ method: 'DELETE', path: '/x', params: { id } })
    signIn(leave, { id: 'bob' })
    await call(withdrawHandler, leave)
    await openTheRegister(id)

    await expect(mark(id, [
      { userId: 'alice', present: true },
      { userId: 'bob', present: true },
    ])).rejects.toMatchObject({ statusCode: 409 })
  })

  it('creates nothing when nobody turned up', async () => {
    const id = await sessionWith(['alice', 'bob'])
    await openTheRegister(id)
    sent.length = 0

    const result = await mark(id, [
      { userId: 'alice', present: false },
      { userId: 'bob', present: false },
    ])

    expect(result.recordCount).toBe(0)
    expect(await recordsFor('alice')).toHaveLength(0)
    expect(sent).toHaveLength(2)
  })
})

describe('prerequisites at register time', () => {
  it('blocks a safety-critical gap that opened since sign-up', async () => {
    await seedRecord({ userId: 'alice', moduleId: 'TECH-111', expiresAt: null })
    const id = await sessionWith(['alice'], ['STGE-201'])
    await openTheRegister(id)

    // The record that let Alice sign up is revoked before the session runs.
    await db.update(schema.records)
      .set({ revokedAt: new Date(), revokedBy: 'trainer', revokeReason: 'Wrong person' })
      .where(and(eq(schema.records.userId, 'alice'), eq(schema.records.moduleId, 'TECH-111')))

    await expect(mark(id, [{ userId: 'alice', present: true }]))
      .rejects.toMatchObject({ statusCode: 422 })
  })

  it('asks for acknowledgement of an ordinary gap, then goes ahead', async () => {
    const id = await sessionWith(['alice'], ['TECH-112'])
    await openTheRegister(id)

    await expect(mark(id, [{ userId: 'alice', present: true }]))
      .rejects.toMatchObject({ statusCode: 409 })

    const result = await mark(id, [{ userId: 'alice', present: true }], { acknowledgeWarnings: true })
    expect(result.recordCount).toBe(1)
  })

  it('ignores a gap belonging to somebody who did not turn up', async () => {
    await seedRecord({ userId: 'alice', moduleId: 'TECH-111', expiresAt: null })
    const id = await sessionWith(['alice'], ['STGE-201'])
    await leadAdds(id, 'bob')
    await openTheRegister(id)

    // Bob has no TECH-111, but Bob is not there, so nothing is awarded to him
    // and there is nothing to block.
    const result = await mark(id, [
      { userId: 'alice', present: true },
      { userId: 'bob', present: false },
    ])
    expect(result.recordCount).toBe(1)
  })
})

describe('the register itself', () => {
  it('is idempotent to open', async () => {
    const id = await sessionWith(['alice'])
    await openTheRegister(id)
    const first = await db.select().from(schema.sessions).where(eq(schema.sessions.id, id)).get()
    await openTheRegister(id)
    const second = await db.select().from(schema.sessions).where(eq(schema.sessions.id, id)).get()

    expect(second!.registerOpenedAt).toEqual(first!.registerOpenedAt)
  })

  it('closes sign-ups once open', async () => {
    const id = await sessionWith(['alice'])
    await openTheRegister(id)

    const event = makeEvent({ method: 'POST', path: '/x', params: { id } })
    signIn(event, { id: 'cara' })
    await expect(call(signupHandler, event)).rejects.toMatchObject({ statusCode: 409 })
  })

  it('lets the lead add a walk-in after sign-ups have closed', async () => {
    const id = await sessionWith(['alice'])
    await openTheRegister(id)

    const event = makeEvent({ method: 'POST', path: '/x', params: { id }, body: { userId: 'cara' } })
    signIn(event, { id: 'trainer' })
    await call(addAttendeeHandler, event)

    const result = await mark(id, [
      { userId: 'alice', present: true },
      { userId: 'cara', present: true },
    ])
    expect(result.recordCount).toBe(2)
  })

  it('shows the waitlist to the lead, marked as such', async () => {
    const id = await sessionWith(['alice', 'bob'], ['NNT-001'], 1)

    const event = makeEvent({ method: 'GET', path: '/x', params: { id } })
    signIn(event, { id: 'trainer' })
    const view = await call(readRegisterHandler, event) as {
      register: { userId: string, hasPlace: boolean }[]
    }

    expect(view.register.find(entry => entry.userId === 'alice')!.hasPlace).toBe(true)
    expect(view.register.find(entry => entry.userId === 'bob')!.hasPlace).toBe(false)
  })

  it('is not readable by somebody who cannot steward the session', async () => {
    const id = await sessionWith(['alice'])
    const event = makeEvent({ method: 'GET', path: '/x', params: { id } })
    signIn(event, { id: 'alice' })
    await expect(call(readRegisterHandler, event)).rejects.toMatchObject({ statusCode: 403 })
  })
})
