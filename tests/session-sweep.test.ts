/**
 * The session sweep. An unmarked register means nobody in the room got a
 * record, so the failure that matters is the sweep going quiet about one.
 */

import { describe, it, expect, beforeEach, mock } from 'bun:test'

const sent: { to: string, subject: string }[] = []

// Intercept at the email boundary so the sweep's own logic runs for real.
const actualEmail = await import('../server/utils/email')

mock.module('../server/utils/email', () => ({
  ...actualEmail,
  sendEmail: mock(async ({ to, subject }: { to: string, subject: string }) => {
    sent.push({ to, subject })
  }),
}))

const { db, schema } = await import('./mocks/nuxthub-db')
const { runSessionSweep } = await import('../server/utils/sessionSweep')
const unmarkedHandler = (await import('../server/api/admin/unmarked-sessions.get')).default
const { seedDepartments, seedModule, seedUser } = await import('./helpers/fixtures')
const { makeEvent, signIn } = await import('./setup')
const { addDays } = await import('../server/utils/validity')
const { eq } = await import('drizzle-orm')

type FakeEvent = ReturnType<typeof makeEvent>

type Handler = (event: FakeEvent) => Promise<unknown>
const call = (handler: unknown, event: FakeEvent) => (handler as Handler)(event)

const ASOF = '2026-08-25'

async function setup() {
  await seedDepartments()
  await seedModule('NNT-001', { name: 'Induction' })
  await seedUser('trainer', 'A Trainer')
  await seedUser('admin', 'An Admin')
  await seedUser('alice', 'Alice Adams')
  await db.insert(schema.siteConfig).values({ key: 'notifications_mode', value: 'live' })
}

/** A session that happened and was never marked. */
async function unmarkedSession(daysAgo: number) {
  const [session] = await db.insert(schema.sessions).values({
    heldOn: addDays(ASOF, -daysAgo),
    status: 'OPEN',
    trainerUserId: 'trainer',
    createdBy: 'trainer',
  }).returning({ id: schema.sessions.id })

  await db.insert(schema.sessionModules).values({ sessionId: session!.id, moduleId: 'NNT-001' })
  await db.insert(schema.sessionAttendees).values({
    sessionId: session!.id, userId: 'alice', status: 'SIGNED_UP',
  })
  return session!.id
}

async function readUnmarked() {
  const event = makeEvent({ method: 'GET', path: '/api/admin/unmarked-sessions' })
  signIn(event, { id: 'admin', roles: ['training:ADMIN'] })
  return call(unmarkedHandler, event) as Promise<{
    sessions: { id: string, daysAgo: number, stale: boolean, signupCount: number, trainerName: string }[]
    hasMore: boolean
  }>
}

beforeEach(async () => {
  sent.length = 0
  await setup()
})

describe('the unmarked-register nag', () => {
  it('nags the lead once the register is overdue', async () => {
    await unmarkedSession(10)
    const result = await runSessionSweep(ASOF)

    expect(result.nags).toBe(1)
    expect(sent[0]!.to).toBe('trainer@dev.newtheatre.org.uk')
  })

  it('stops emailing after the cutoff rather than nagging a graduate forever', async () => {
    await unmarkedSession(90)
    const result = await runSessionSweep(ASOF)

    expect(result.nags).toBe(0)
    expect(sent).toHaveLength(0)
  })

  it('counts what it has stopped nagging about, so the silence is visible', async () => {
    await unmarkedSession(90)
    await unmarkedSession(10)

    // Nobody in that room has a record, and the sweep is no longer asking for
    // one: the count is what stops that being indistinguishable from nothing.
    expect((await runSessionSweep(ASOF)).stale).toBe(1)
  })

  it('honours an operator-set cutoff', async () => {
    await db.insert(schema.siteConfig).values({ key: 'register_nag_stop_days', value: '120' })
    await unmarkedSession(90)

    const result = await runSessionSweep(ASOF)
    expect(result.nags).toBe(1)
    expect(result.stale).toBe(0)
  })
})

describe('GET /api/admin/unmarked-sessions', () => {
  it('lists a session the nag has given up on, oldest first', async () => {
    await unmarkedSession(90)
    await unmarkedSession(10)

    const { sessions } = await readUnmarked()
    expect(sessions).toHaveLength(2)
    expect(sessions[0]!.daysAgo).toBe(90)
    expect(sessions[0]!.stale).toBe(true)
    expect(sessions[1]!.stale).toBe(false)
  })

  it('names the lead and how many people are waiting on a record', async () => {
    await unmarkedSession(90)

    const [session] = (await readUnmarked()).sessions
    expect(session!.trainerName).toBe('A Trainer')
    expect(session!.signupCount).toBe(1)
  })

  it('leaves out a session that was marked or cancelled', async () => {
    const marked = await unmarkedSession(90)
    await db.update(schema.sessions).set({ status: 'DELIVERED' })
      .where(eq(schema.sessions.id, marked))

    expect((await readUnmarked()).sessions).toHaveLength(0)
  })

  it('refuses a member', async () => {
    const event = makeEvent({ method: 'GET', path: '/api/admin/unmarked-sessions' })
    signIn(event, { id: 'alice' })
    await expect(call(unmarkedHandler, event)).rejects.toMatchObject({ statusCode: 403 })
  })
})
