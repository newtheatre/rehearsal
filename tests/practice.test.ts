/**
 * Practice targets and windows (ADR-0014). The scoping tests are the point:
 * most modules have no sandbox and must open nothing.
 */

import { today } from '../shared/utils/dates'

import { describe, it, expect, beforeEach } from 'bun:test'
import { db, schema } from './mocks/nuxthub-db'
import { eq } from 'drizzle-orm'
import { makeEvent, signIn, runtimeConfig, type FakeEvent } from './setup'
import { seedDepartments, seedModule, seedRecord, seedUser } from './helpers/fixtures'
import { hashServiceToken, TOKEN_PREFIX } from '../server/utils/serviceToken'
import scheduleHandler from '../server/api/sessions/schedule.post'
import signupHandler from '../server/api/sessions/[id]/signup.post'
import openRegisterHandler from '../server/api/sessions/[id]/register/open.post'
import markHandler from '../server/api/sessions/[id]/register/index.post'
import readRegisterHandler from '../server/api/sessions/[id]/register/index.get'
import cancelHandler from '../server/api/sessions/[id]/cancel.post'
import practiceHandler from '../server/api/v1/practice/[key].get'
import targetsPutHandler from '../server/api/admin/practice-targets/index.put'
import grantHandler from '../server/api/practice-windows/index.post'
import closeHandler from '../server/api/practice-windows/[id]/index.delete'
import addAttendeeHandler from '../server/api/sessions/[id]/attendees.post'
import withdrawHandler from '../server/api/sessions/[id]/signup.delete'

type Handler = (event: FakeEvent) => Promise<unknown>
const call = (handler: unknown, event: FakeEvent) => (handler as Handler)(event)

const SERVICE_TOKEN = `${TOKEN_PREFIX}practice-token`
const TODAY = today()

async function setup() {
  await seedDepartments()
  await seedModule('LEAD-CERT', {
    department: 'LEAD',
    kind: 'CERTIFICATION',
    signoffRequired: true,
    grantsTrainer: true,
  })
  await seedModule('NNT-001', { name: 'Induction' })
  await seedModule('ADMN-102', { department: 'ADMN', name: 'Selling Alcohol' })
  await seedModule('ADMN-103', { department: 'ADMN', name: 'Box Office' })
  await seedModule('TECH-111', { name: 'Rigging' })

  await seedUser('trainer', 'A Trainer')
  await seedUser('admin', 'An Admin')
  await seedUser('alice', 'Alice Adams')
  await seedUser('bob', 'Bob Barnes')
  await seedRecord({ userId: 'trainer', moduleId: 'LEAD-CERT', expiresAt: null })

  await db.insert(schema.serviceTokens).values({
    name: 'proscenium',
    tokenHash: hashServiceToken(SERVICE_TOKEN),
    scopes: 'read',
  })
}

async function seedDepartmentsWithAdmn() {
  await db.insert(schema.departments).values({ code: 'ADMN', name: 'ADMN', sort: 9 })
}

/** Create a target through the real admin route, as the page sends it. */
async function putTarget(body: Record<string, unknown>) {
  const event = makeEvent({
    method: 'PUT',
    path: '/api/admin/practice-targets',
    body: { moduleIds: [], status: 'ACTIVE', ...body },
  })
  signIn(event, { id: 'admin', roles: ['training:ADMIN'] })
  return call(targetsPutHandler, event)
}

async function sessionTeaching(moduleIds: string[], attendees: string[]) {
  const create = makeEvent({ method: 'POST', path: '/api/sessions/schedule', body: {
    heldOn: TODAY,
    moduleIds,
    openNow: true,
  } })
  signIn(create, { id: 'trainer' })
  const { id } = await call(scheduleHandler, create) as { id: string }

  for (const user of attendees) {
    const event = makeEvent({ method: 'POST', path: '/x', params: { id } })
    signIn(event, { id: user })
    await call(signupHandler, event)
  }
  return id
}

async function readRegister(id: string) {
  const event = makeEvent({ method: 'GET', path: '/x', params: { id } })
  signIn(event, { id: 'trainer' })
  return call(readRegisterHandler, event) as Promise<{ practiceTargets: string[], practiceOpen: string[] }>
}

async function openTheRegister(id: string) {
  const event = makeEvent({ method: 'POST', path: '/x', params: { id } })
  signIn(event, { id: 'trainer' })
  return call(openRegisterHandler, event) as Promise<{ practiceOpened: string[] }>
}

/** Ask the consumer endpoint, as Proscenium would. */
async function ask(key: string, userId: string) {
  const event = makeEvent({
    method: 'GET',
    path: `/api/v1/practice/${key}`,
    params: { key },
    query: { userId },
    headers: { authorization: `Bearer ${SERVICE_TOKEN}` },
  })
  return call(practiceHandler, event) as Promise<{ active: boolean, sessionId: string | null }>
}

beforeEach(async () => {
  runtimeConfig.authServiceToken = ''
  await seedDepartmentsWithAdmn()
  await setup()
  await putTarget({
    key: 'bar-till',
    name: 'Bar till',
    consumer: 'proscenium',
    moduleIds: ['ADMN-102', 'ADMN-103'],
  })
})

describe('what a session opens', () => {
  it('opens a window for a module the target names', async () => {
    const id = await sessionTeaching(['ADMN-102'], ['alice'])
    const result = await openTheRegister(id)

    expect(result.practiceOpened).toEqual(['bar-till'])
    expect(await ask('bar-till', 'alice')).toMatchObject({ active: true, sessionId: id })
  })

  it('opens nothing for a module in no target', async () => {
    const id = await sessionTeaching(['TECH-111'], ['alice'])
    const result = await openTheRegister(id)

    // The lighting-desk case: silence is the correct behaviour.
    expect(result.practiceOpened).toEqual([])
    expect(await ask('bar-till', 'alice')).toMatchObject({ active: false })

    const windows = await db.select().from(schema.practiceWindows).all()
    expect(windows).toHaveLength(0)
  })

  it('opens nothing for a retired target', async () => {
    await putTarget({
      key: 'bar-till',
      name: 'Bar till',
      moduleIds: ['ADMN-102'],
      status: 'RETIRED',
    })

    const id = await sessionTeaching(['ADMN-102'], ['alice'])
    expect((await openTheRegister(id)).practiceOpened).toEqual([])
  })

  it('opens one window per person signed up, and nobody else', async () => {
    const id = await sessionTeaching(['ADMN-102'], ['alice'])
    await openTheRegister(id)

    expect(await ask('bar-till', 'alice')).toMatchObject({ active: true })
    expect(await ask('bar-till', 'bob')).toMatchObject({ active: false })
  })

  it('leaves the register unopened when the windows fail, so a retry does it all', async () => {
    const id = await sessionTeaching(['ADMN-102'], ['alice'])

    // A transient D1 failure on the write. The stamp is the retry guard, so it
    // must not survive a batch that did not open a single window.
    type Batching = { batch: (...args: unknown[]) => Promise<unknown> }
    const batching = db as unknown as Batching
    const realBatch = batching.batch.bind(batching)
    batching.batch = async () => {
      throw new Error('D1 hiccup')
    }

    try {
      await expect(openTheRegister(id)).rejects.toThrow()
    }
    finally {
      batching.batch = realBatch
    }

    const session = await db.select().from(schema.sessions).where(eq(schema.sessions.id, id)).get()
    expect(session!.registerOpenedAt).toBeNull()
    expect(await db.select().from(schema.practiceWindows).all()).toHaveLength(0)
    expect(await db.select().from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'session.register.open')).all()).toHaveLength(0)

    expect((await openTheRegister(id)).practiceOpened).toEqual(['bar-till'])
    expect(await ask('bar-till', 'alice')).toMatchObject({ active: true })
    expect(await db.select().from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'session.register.open')).all()).toHaveLength(1)
  })

  it('reports what is open, not merely what matches, so the page cannot overclaim', async () => {
    const id = await sessionTeaching(['ADMN-102'], ['alice'])

    const before = await readRegister(id)
    expect(before.practiceTargets).toEqual(['bar-till'])
    expect(before.practiceOpen).toEqual([])

    await openTheRegister(id)
    expect((await readRegister(id)).practiceOpen).toEqual(['bar-till'])
  })

  it('opens both targets when a session teaches modules in each', async () => {
    await putTarget({
      key: 'challenge-25',
      name: 'Challenge 25',
      moduleIds: ['ADMN-102'],
    })

    const id = await sessionTeaching(['ADMN-102'], ['alice'])
    const result = await openTheRegister(id)

    expect(result.practiceOpened.sort()).toEqual(['bar-till', 'challenge-25'])
  })
})

describe('walk-ins', () => {
  it('opens a window for somebody added after the register did', async () => {
    const id = await sessionTeaching(['ADMN-102'], ['alice'])
    await openTheRegister(id)
    expect(await ask('bar-till', 'bob')).toMatchObject({ active: false })

    const add = makeEvent({ method: 'POST', path: '/x', params: { id }, body: { userId: 'bob' } })
    signIn(add, { id: 'trainer' })
    await call(addAttendeeHandler, add)

    // Otherwise the walk-in is the one person in the room who cannot practise.
    expect(await ask('bar-till', 'bob')).toMatchObject({ active: true })
  })
})

describe('closing', () => {
  it('closes the window when the register is marked', async () => {
    const id = await sessionTeaching(['ADMN-102'], ['alice'])
    await openTheRegister(id)
    expect(await ask('bar-till', 'alice')).toMatchObject({ active: true })

    const mark = makeEvent({
      method: 'POST',
      path: '/x',
      params: { id },
      body: { marks: [{ userId: 'alice', present: true }] },
    })
    signIn(mark, { id: 'trainer' })
    await call(markHandler, mark)

    // The lesson is over, so the sandbox goes with it.
    expect(await ask('bar-till', 'alice')).toMatchObject({ active: false })
  })

  it('closes it for an absentee too', async () => {
    const id = await sessionTeaching(['ADMN-102'], ['alice'])
    await openTheRegister(id)

    const mark = makeEvent({
      method: 'POST',
      path: '/x',
      params: { id },
      body: { marks: [{ userId: 'alice', present: false }], acknowledgeAllAbsent: true },
    })
    signIn(mark, { id: 'trainer' })
    await call(markHandler, mark)

    expect(await ask('bar-till', 'alice')).toMatchObject({ active: false })
  })

  it('closes it for somebody who withdraws after the register opened', async () => {
    const id = await sessionTeaching(['ADMN-102'], ['alice', 'bob'])
    await openTheRegister(id)
    expect(await ask('bar-till', 'alice')).toMatchObject({ active: true })

    const leave = makeEvent({ method: 'DELETE', path: '/x', params: { id } })
    signIn(leave, { id: 'alice' })
    await call(withdrawHandler, leave)

    // She has gone home, and cannot rejoin: the sandbox goes with her.
    expect(await ask('bar-till', 'alice')).toMatchObject({ active: false })
    // And only hers: the rest of the room is still being taught.
    expect(await ask('bar-till', 'bob')).toMatchObject({ active: true })
  })

  it('closes it when the session is cancelled', async () => {
    const id = await sessionTeaching(['ADMN-102'], ['alice'])
    await openTheRegister(id)

    const cancel = makeEvent({
      method: 'POST',
      path: '/x',
      params: { id },
      body: { reason: 'Nobody can make it' },
    })
    signIn(cancel, { id: 'trainer' })
    await call(cancelHandler, cancel)

    expect(await ask('bar-till', 'alice')).toMatchObject({ active: false })
  })

  it('stops answering the moment a lead closes it by hand', async () => {
    const id = await sessionTeaching(['ADMN-102'], ['alice'])
    await openTheRegister(id)

    const window = await db.select().from(schema.practiceWindows).get()
    const close = makeEvent({ method: 'DELETE', path: '/x', params: { id: window!.id } })
    signIn(close, { id: 'trainer' })
    await call(closeHandler, close)

    expect(await ask('bar-till', 'alice')).toMatchObject({ active: false })
  })

  it('stops answering once expired', async () => {
    const id = await sessionTeaching(['ADMN-102'], ['alice'])
    await openTheRegister(id)

    await db.update(schema.practiceWindows)
      .set({ expiresAt: new Date(Date.now() - 1000) })

    expect(await ask('bar-till', 'alice')).toMatchObject({ active: false })
  })

  it('stops answering if the target is retired underneath it', async () => {
    const id = await sessionTeaching(['ADMN-102'], ['alice'])
    await openTheRegister(id)

    await putTarget({
      key: 'bar-till',
      name: 'Bar till',
      moduleIds: ['ADMN-102'],
      status: 'RETIRED',
    })

    await expect(ask('bar-till', 'alice')).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('the consumer endpoint', () => {
  it('refuses without a service token', async () => {
    const event = makeEvent({
      method: 'GET',
      path: '/api/v1/practice/bar-till',
      params: { key: 'bar-till' },
      query: { userId: 'alice' },
    })
    await expect(call(practiceHandler, event)).rejects.toMatchObject({ statusCode: 401 })
  })

  it('404s on an unknown key rather than answering false', async () => {
    // A renamed target is a configuration break across two repos, not a
    // person who happens not to be practising.
    await expect(ask('no-such-target', 'alice')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('404s on an unknown user', async () => {
    await expect(ask('bar-till', 'nobody')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('is never cached', async () => {
    const id = await sessionTeaching(['ADMN-102'], ['alice'])
    await openTheRegister(id)

    const event = makeEvent({
      method: 'GET',
      path: '/api/v1/practice/bar-till',
      params: { key: 'bar-till' },
      query: { userId: 'alice' },
      headers: { authorization: `Bearer ${SERVICE_TOKEN}` },
    })
    await call(practiceHandler, event)

    expect(event.responseHeaders).toMatchObject({ 'Cache-Control': 'no-store' })
  })
})

describe('an ad-hoc grant', () => {
  it('opens a window with no session behind it', async () => {
    const event = makeEvent({ method: 'POST', path: '/api/practice-windows', body: {
      userId: 'bob',
      targetKey: 'bar-till',
      hours: 2,
      reason: 'Coaching before Friday',
    } })
    signIn(event, { id: 'trainer' })
    await call(grantHandler, event)

    expect(await ask('bar-till', 'bob')).toMatchObject({ active: true, sessionId: null })
  })

  it('refuses for somebody this app has never seen', async () => {
    const event = makeEvent({ method: 'POST', path: '/api/practice-windows', body: {
      userId: 'stranger',
      targetKey: 'bar-till',
      reason: 'Coaching before Friday',
    } })
    signIn(event, { id: 'trainer' })
    await expect(call(grantHandler, event)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('is not something an ordinary member can do', async () => {
    const event = makeEvent({ method: 'POST', path: '/api/practice-windows', body: {
      userId: 'bob',
      targetKey: 'bar-till',
      reason: 'I would like a go on the till',
    } })
    signIn(event, { id: 'alice' })
    await expect(call(grantHandler, event)).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('targets are data', () => {
  it('refuses a target naming a module that does not exist', async () => {
    await expect(putTarget({
      key: 'nonsense',
      name: 'Nonsense',
      moduleIds: ['ZZZZ-999'],
    })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('is editable without a deploy, and the change takes effect at once', async () => {
    const before = await sessionTeaching(['TECH-111'], ['alice'])
    expect((await openTheRegister(before)).practiceOpened).toEqual([])

    await putTarget({
      key: 'bar-till',
      name: 'Bar till',
      moduleIds: ['ADMN-102', 'TECH-111'],
    })

    const after = await sessionTeaching(['TECH-111'], ['bob'])
    expect((await openTheRegister(after)).practiceOpened).toEqual(['bar-till'])
  })

  it('refuses a payload that omits the module list or the status', async () => {
    // A full replacement, so a missing field would empty a live target's
    // module list or un-retire one that was shut on purpose.
    await expect(putTarget({ key: 'bar-till', name: 'Bar till', moduleIds: undefined }))
      .rejects.toThrow()
    await expect(putTarget({ key: 'bar-till', name: 'Bar till', status: undefined }))
      .rejects.toThrow()

    const target = await db.select().from(schema.practiceTargets)
      .where(eq(schema.practiceTargets.key, 'bar-till')).get()
    expect(target!.moduleIds).toEqual(['ADMN-102', 'ADMN-103'])
  })

  it('refuses a create on a key that is already taken', async () => {
    // The page checks against a list it last refreshed, so two admins can both
    // pass it; the server holds the line.
    await expect(putTarget({
      key: 'bar-till',
      name: 'Something else',
      moduleIds: ['TECH-111'],
      create: true,
    })).rejects.toMatchObject({ statusCode: 409 })

    const target = await db.select().from(schema.practiceTargets)
      .where(eq(schema.practiceTargets.key, 'bar-till')).get()
    expect(target!.name).toBe('Bar till')
    expect(target!.moduleIds).toEqual(['ADMN-102', 'ADMN-103'])
  })

  it('needs config.manage to edit', async () => {
    const event = makeEvent({ method: 'PUT', path: '/api/admin/practice-targets', body: {
      key: 'bar-till',
      name: 'Bar till',
      moduleIds: [],
    } })
    signIn(event, { id: 'trainer' })
    await expect(call(targetsPutHandler, event)).rejects.toMatchObject({ statusCode: 403 })
  })
})
