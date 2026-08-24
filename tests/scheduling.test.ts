/**
 * Scheduling and sign-ups, through the real handlers. The load-bearing claims
 * are that scheduling awards nothing and that a place is derived (ADR-0013).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const sent: { to: string, subject: string }[] = []

// Intercept at the email boundary so the handlers' own logic runs for real.
vi.mock('../server/utils/email', async () => {
  const actual = await vi.importActual<typeof import('../server/utils/email')>('../server/utils/email')
  return {
    ...actual,
    sendEmail: vi.fn(async ({ to, subject }: { to: string, subject: string }) => {
      sent.push({ to, subject })
    }),
  }
})

const { db, schema, resetQueryCount, widestBoundStatement } = await import('./mocks/nuxthub-db')
const { makeEvent, signIn } = await import('./setup')
type FakeEvent = import('./setup').FakeEvent
const { seedDepartments, seedModule, seedRecord, seedUser } = await import('./helpers/fixtures')
const { today, londonTimeOf } = await import('../shared/utils/dates')
const { eq } = await import('drizzle-orm')

const scheduleHandler = (await import('../server/api/sessions/schedule.post')).default
const upcomingHandler = (await import('../server/api/sessions/upcoming.get')).default
const openHandler = (await import('../server/api/sessions/[id]/open.post')).default
const cancelHandler = (await import('../server/api/sessions/[id]/cancel.post')).default
const signupHandler = (await import('../server/api/sessions/[id]/signup.post')).default
const withdrawHandler = (await import('../server/api/sessions/[id]/signup.delete')).default
const logHandler = (await import('../server/api/sessions/index.get')).default
const reschedule = (await import('../server/api/sessions/[id]/schedule.put')).default
const openRegisterHandler = (await import('../server/api/sessions/[id]/register/open.post')).default
const editHandler = (await import('../server/api/sessions/[id].put')).default

type Handler = (event: FakeEvent) => Promise<unknown>
const call = (handler: unknown, event: FakeEvent) => (handler as Handler)(event)

function tomorrow(): string {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  return date.toISOString().slice(0, 10)
}

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
  // Safety-critical, so a gap blocks rather than warns.
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

/** Schedule a session and open sign-ups, returning its id. */
async function openSession(body: Record<string, unknown> = {}) {
  const event = makeEvent({ method: 'POST', path: '/api/sessions/schedule', body: {
    heldOn: tomorrow(),
    moduleIds: ['NNT-001'],
    openNow: true,
    ...body,
  } })
  signIn(event, { id: 'trainer' })
  const created = await call(scheduleHandler, event) as { id: string }
  return created.id
}

async function signUpAs(sessionId: string, userId: string) {
  const event = makeEvent({ method: 'POST', path: '/api/sessions/x/signup', params: { id: sessionId } })
  signIn(event, { id: userId })
  return call(signupHandler, event) as Promise<{ hasPlace: boolean, waitlistPosition: number | null }>
}

async function withdrawAs(sessionId: string, userId: string) {
  const event = makeEvent({ method: 'DELETE', path: '/api/sessions/x/signup', params: { id: sessionId } })
  signIn(event, { id: userId })
  return call(withdrawHandler, event) as Promise<{ promoted: number }>
}

beforeEach(async () => {
  sent.length = 0
  await setup()
})

describe('scheduling awards nothing', () => {
  it('creates a session with no records', async () => {
    const id = await openSession()

    const records = await db.select().from(schema.records)
      .where(eq(schema.records.sessionId, id)).all()
    expect(records).toHaveLength(0)
  })

  it('signing up creates no records either', async () => {
    const id = await openSession()
    await signUpAs(id, 'alice')

    const records = await db.select().from(schema.records).all()
    // Only the trainer's seeded certification.
    expect(records.filter(record => record.sessionId === id)).toHaveLength(0)
  })

  it('cancelling creates no records and tells everyone signed up', async () => {
    const id = await openSession()
    await signUpAs(id, 'alice')
    await signUpAs(id, 'bob')
    sent.length = 0

    const event = makeEvent({
      method: 'POST',
      path: '/api/sessions/x/cancel',
      params: { id },
      body: { reason: 'The rig is out of action' },
    })
    signIn(event, { id: 'trainer' })
    await call(cancelHandler, event)

    const records = await db.select().from(schema.records)
      .where(eq(schema.records.sessionId, id)).all()
    expect(records).toHaveLength(0)
    expect(sent.map(mail => mail.to).sort()).toEqual([
      'alice@dev.newtheatre.org.uk',
      'bob@dev.newtheatre.org.uk',
    ])
    expect(sent[0]!.subject).toContain('Cancelled')
  })

  it('refuses a date in the past, which is the delivery log\'s job', async () => {
    const event = makeEvent({ method: 'POST', path: '/api/sessions/schedule', body: {
      heldOn: '2020-01-01',
      moduleIds: ['NNT-001'],
    } })
    signIn(event, { id: 'trainer' })
    await expect(call(scheduleHandler, event)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('refuses rescheduling onto a module a session may not teach', async () => {
    const id = await openSession()
    const event = makeEvent({ method: 'PUT', path: '/x', params: { id }, body: {
      moduleIds: ['LEAD-CERT'],
    } })
    signIn(event, { id: 'trainer' })
    // The gate that guards creation must guard amendment too, or a session
    // can be booked onto something its own register would refuse.
    await expect(call(reschedule, event)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('refuses a module that must be signed off instead', async () => {
    const event = makeEvent({ method: 'POST', path: '/api/sessions/schedule', body: {
      heldOn: tomorrow(),
      moduleIds: ['LEAD-CERT'],
    } })
    signIn(event, { id: 'trainer' })
    await expect(call(scheduleHandler, event)).rejects.toMatchObject({ statusCode: 400 })
  })
})

describe('the delivery log stays the record of what was taught', () => {
  it('does not list a scheduled session', async () => {
    const id = await openSession()

    const event = makeEvent({ method: 'GET', path: '/api/sessions', query: {} })
    signIn(event, { id: 'alice' })
    const log = await call(logHandler, event) as { sessions: { id: string }[] }

    expect(log.sessions.map(session => session.id)).not.toContain(id)
  })

  it('refuses the record-editing route on a session not yet delivered', async () => {
    const id = await openSession()

    const event = makeEvent({ method: 'PUT', path: '/api/sessions/x', params: { id }, body: {
      heldOn: today(),
      moduleIds: ['NNT-001'],
      attendeeIds: ['alice'],
    } })
    signIn(event, { id: 'trainer' })
    await expect(call(editHandler, event)).rejects.toMatchObject({ statusCode: 409 })
  })
})

describe('places are derived from sign-up order', () => {
  it('gives places up to capacity and waitlists the rest', async () => {
    const id = await openSession({ capacity: 2 })

    expect(await signUpAs(id, 'alice')).toMatchObject({ hasPlace: true })
    expect(await signUpAs(id, 'bob')).toMatchObject({ hasPlace: true })
    expect(await signUpAs(id, 'cara')).toMatchObject({ hasPlace: false, waitlistPosition: 1 })
  })

  it('never refuses a sign-up for being full', async () => {
    const id = await openSession({ capacity: 1 })
    await signUpAs(id, 'alice')

    await expect(signUpAs(id, 'bob')).resolves.toMatchObject({ hasPlace: false })
  })

  it('hands the last place to exactly one of two simultaneous sign-ups', async () => {
    const id = await openSession({ capacity: 1 })

    const [first, second] = await Promise.all([
      signUpAs(id, 'alice'),
      signUpAs(id, 'bob'),
    ])

    // The point of deriving it: both writes succeed, and the place is still
    // one place. A stored status would have handed it out twice.
    expect([first.hasPlace, second.hasPlace].filter(Boolean)).toHaveLength(1)
  })

  it('promotes the next person on a withdrawal, and tells them', async () => {
    const id = await openSession({ capacity: 1 })
    await signUpAs(id, 'alice')
    await signUpAs(id, 'bob')
    sent.length = 0

    const result = await withdrawAs(id, 'alice')

    expect(result.promoted).toBe(1)
    expect(sent).toHaveLength(1)
    expect(sent[0]!.to).toBe('bob@dev.newtheatre.org.uk')
    expect(sent[0]!.subject).toContain('place has come free')
  })

  it('still lets somebody withdraw once the register is open', async () => {
    const id = await openSession()
    await signUpAs(id, 'alice')

    const open = makeEvent({ method: 'POST', path: '/x', params: { id } })
    signIn(open, { id: 'trainer' })
    await call(openRegisterHandler, open)

    // Otherwise they have no way out of being marked absent.
    await expect(withdrawAs(id, 'alice')).resolves.toMatchObject({ promoted: 0 })
  })

  it('promotes nobody when the person leaving was on the waitlist', async () => {
    const id = await openSession({ capacity: 1 })
    await signUpAs(id, 'alice')
    await signUpAs(id, 'bob')
    sent.length = 0

    expect(await withdrawAs(id, 'bob')).toMatchObject({ promoted: 0 })
    expect(sent).toHaveLength(0)
  })

  it('sends a re-joiner to the back of the queue', async () => {
    const id = await openSession({ capacity: 1 })
    await signUpAs(id, 'alice')
    await withdrawAs(id, 'alice')
    await signUpAs(id, 'bob')

    expect(await signUpAs(id, 'alice')).toMatchObject({ hasPlace: false, waitlistPosition: 1 })
  })

  it('keeps everyone when the session is uncapped', async () => {
    const id = await openSession()
    for (const user of ['alice', 'bob', 'cara']) {
      expect(await signUpAs(id, user)).toMatchObject({ hasPlace: true })
    }
  })

  it('refuses a second sign-up from the same person', async () => {
    const id = await openSession()
    await signUpAs(id, 'alice')
    await expect(signUpAs(id, 'alice')).rejects.toMatchObject({ statusCode: 409 })
  })
})

describe('changing capacity', () => {
  it('emails whoever it moved into a place, and clears the full badge', async () => {
    const id = await openSession({ capacity: 1 })
    await signUpAs(id, 'alice')
    await signUpAs(id, 'bob')
    expect((await db.select().from(schema.sessions).where(eq(schema.sessions.id, id)).get())!.status).toBe('FULL')
    sent.length = 0

    const event = makeEvent({ method: 'PUT', path: '/x', params: { id }, body: { capacity: 3 } })
    signIn(event, { id: 'trainer' })
    await call(reschedule, event)

    expect(sent).toHaveLength(1)
    expect(sent[0]!.to).toBe('bob@dev.newtheatre.org.uk')
    expect(sent[0]!.subject).toContain('place has come free')
    // The schedule must stop advertising it as full.
    expect((await db.select().from(schema.sessions).where(eq(schema.sessions.id, id)).get())!.status).toBe('OPEN')
  })

  it('keeps free text out of the audit trail', async () => {
    const id = await openSession()
    const event = makeEvent({ method: 'PUT', path: '/x', params: { id }, body: {
      notes: 'Moved because Sam is injured',
    } })
    signIn(event, { id: 'trainer' })
    await call(reschedule, event)

    const entry = await db.select().from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'session.reschedule')).get()
    expect(entry!.detail).not.toContain('Sam')
    expect(entry!.detail).toContain('notes')
  })
})

describe('sign-up gating', () => {
  it('blocks a safety-critical module when a prerequisite is missing', async () => {
    const id = await openSession({ moduleIds: ['STGE-201'] })
    await expect(signUpAs(id, 'alice')).rejects.toMatchObject({ statusCode: 422 })
  })

  it('warns but allows when the module is not safety-critical', async () => {
    const id = await openSession({ moduleIds: ['TECH-112'] })
    const result = await signUpAs(id, 'alice') as { hasPlace: boolean, warnings: unknown[] }

    expect(result.hasPlace).toBe(true)
    expect(result.warnings).toHaveLength(1)
  })

  it('allows the safety-critical module once the prerequisite is held', async () => {
    await seedRecord({ userId: 'alice', moduleId: 'TECH-111', expiresAt: null })
    const id = await openSession({ moduleIds: ['STGE-201'] })

    await expect(signUpAs(id, 'alice')).resolves.toMatchObject({ hasPlace: true })
  })

  it('refuses while the session is only planned', async () => {
    const event = makeEvent({ method: 'POST', path: '/api/sessions/schedule', body: {
      heldOn: tomorrow(),
      moduleIds: ['NNT-001'],
    } })
    signIn(event, { id: 'trainer' })
    const { id } = await call(scheduleHandler, event) as { id: string }

    await expect(signUpAs(id, 'alice')).rejects.toMatchObject({ statusCode: 409 })
  })

  it('refuses once the session is cancelled', async () => {
    const id = await openSession()
    const event = makeEvent({
      method: 'POST',
      path: '/api/sessions/x/cancel',
      params: { id },
      body: { reason: 'Nobody can make it' },
    })
    signIn(event, { id: 'trainer' })
    await call(cancelHandler, event)

    await expect(signUpAs(id, 'alice')).rejects.toMatchObject({ statusCode: 409 })
  })

  it('refuses once sign-ups have closed', async () => {
    const id = await openSession({ signupsCloseAt: new Date(Date.now() - 1000).toISOString() })
    await expect(signUpAs(id, 'alice')).rejects.toMatchObject({ statusCode: 409 })
  })
})

describe('times are Europe/London wall-clock', () => {
  it('anchors a 19:30 session to London, not to the runner or the browser', async () => {
    const day = tomorrow()
    const event = makeEvent({ method: 'POST', path: '/api/sessions/schedule', body: {
      heldOn: day,
      moduleIds: ['NNT-001'],
      startsTime: '19:30',
      endsTime: '21:00',
      openNow: true,
    } })
    signIn(event, { id: 'trainer' })
    const { id } = await call(scheduleHandler, event) as { id: string }

    const row = await db.select().from(schema.sessions).where(eq(schema.sessions.id, id)).get()
    // Reading the stored instant back in London must give the time typed in.
    expect(londonTimeOf(row!.startsAt!)).toBe('19:30')
    expect(londonTimeOf(row!.endsAt!)).toBe('21:00')
  })

  it('moves the instants when the date moves', async () => {
    const day = tomorrow()
    const create = makeEvent({ method: 'POST', path: '/api/sessions/schedule', body: {
      heldOn: day,
      moduleIds: ['NNT-001'],
      startsTime: '19:30',
      openNow: true,
    } })
    signIn(create, { id: 'trainer' })
    const { id } = await call(scheduleHandler, create) as { id: string }

    const later = new Date(`${day}T00:00:00Z`)
    later.setUTCDate(later.getUTCDate() + 7)
    const moved = later.toISOString().slice(0, 10)

    const edit = makeEvent({ method: 'PUT', path: '/x', params: { id }, body: { heldOn: moved } })
    signIn(edit, { id: 'trainer' })
    await call(reschedule, edit)

    const row = await db.select().from(schema.sessions).where(eq(schema.sessions.id, id)).get()
    expect(row!.heldOn).toBe(moved)
    // The time of day survives a date change rather than being left behind.
    expect(londonTimeOf(row!.startsAt!)).toBe('19:30')
  })
})

describe('D1 parameter limits', () => {
  it('lists a schedule larger than D1 can bind in one statement', async () => {
    // 120 sessions: an IN list of the ids just returned would bind 121
    // parameters, over the cap of 100.
    const day = tomorrow()
    for (let n = 0; n < 120; n++) {
      const event = makeEvent({ method: 'POST', path: '/api/sessions/schedule', body: {
        heldOn: day,
        moduleIds: ['NNT-001'],
        openNow: true,
      } })
      signIn(event, { id: 'trainer' })
      await call(scheduleHandler, event)
    }

    resetQueryCount()
    const view = makeEvent({ method: 'GET', path: '/api/sessions/upcoming' })
    signIn(view, { id: 'alice' })
    const result = await call(upcomingHandler, view) as { sessions: { moduleIds: string[] }[] }

    // The rule itself: no statement's parameter count tracks the row count.
    expect(widestBoundStatement()).toBeLessThan(100)
    // And the scoping did not silently drop the follow-up query.
    expect(result.sessions).toHaveLength(100)
    expect(result.sessions.every(session => session.moduleIds.length === 1)).toBe(true)
  })
})

describe('the schedule', () => {
  it('shows a planned session to a trainer and not to a member', async () => {
    const event = makeEvent({ method: 'POST', path: '/api/sessions/schedule', body: {
      heldOn: tomorrow(),
      moduleIds: ['NNT-001'],
    } })
    signIn(event, { id: 'trainer' })
    const { id } = await call(scheduleHandler, event) as { id: string }

    const asTrainer = makeEvent({ method: 'GET', path: '/api/sessions/upcoming' })
    signIn(asTrainer, { id: 'trainer' })
    const trainerView = await call(upcomingHandler, asTrainer) as { sessions: { id: string }[] }
    expect(trainerView.sessions.map(session => session.id)).toContain(id)

    const asMember = makeEvent({ method: 'GET', path: '/api/sessions/upcoming' })
    signIn(asMember, { id: 'alice' })
    const memberView = await call(upcomingHandler, asMember) as { sessions: { id: string }[] }
    expect(memberView.sessions.map(session => session.id)).not.toContain(id)
  })

  it('reports places left and marks what the member has joined', async () => {
    const id = await openSession({ capacity: 3 })
    await signUpAs(id, 'alice')

    const event = makeEvent({ method: 'GET', path: '/api/sessions/upcoming' })
    signIn(event, { id: 'alice' })
    const view = await call(upcomingHandler, event) as {
      sessions: { id: string, placesLeft: number | null, signedUp: boolean, hasPlace: boolean }[]
    }

    const session = view.sessions.find(item => item.id === id)!
    expect(session.placesLeft).toBe(2)
    expect(session.signedUp).toBe(true)
    expect(session.hasPlace).toBe(true)
  })

  it('tells a waitlisted member they are on the waitlist, not signed up', async () => {
    const id = await openSession({ capacity: 1 })
    await signUpAs(id, 'alice')
    await signUpAs(id, 'bob')

    const event = makeEvent({ method: 'GET', path: '/api/sessions/upcoming' })
    signIn(event, { id: 'bob' })
    const view = await call(upcomingHandler, event) as {
      sessions: { id: string, signedUp: boolean, hasPlace: boolean }[]
    }

    const session = view.sessions.find(item => item.id === id)!
    expect(session.signedUp).toBe(true)
    // Saying "you are signed up" to somebody without a place is how a
    // session ends up under-attended.
    expect(session.hasPlace).toBe(false)
  })

  it('badges a full session without letting the badge gate a sign-up', async () => {
    const id = await openSession({ capacity: 1 })
    await signUpAs(id, 'alice')

    const row = await db.select().from(schema.sessions).where(eq(schema.sessions.id, id)).get()
    expect(row!.status).toBe('FULL')

    // The badge says full; the waitlist still accepts people (design §3.3).
    await expect(signUpAs(id, 'bob')).resolves.toMatchObject({ hasPlace: false })
  })

  it('opens a planned session only from PLANNED', async () => {
    const id = await openSession()
    const event = makeEvent({ method: 'POST', path: '/api/sessions/x/open', params: { id } })
    signIn(event, { id: 'trainer' })
    await expect(call(openHandler, event)).rejects.toMatchObject({ statusCode: 409 })
  })
})
