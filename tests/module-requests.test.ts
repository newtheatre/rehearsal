/**
 * Demand signals. A request obliges nobody, and nothing on a timer resolves
 * one. docs/scheduling-design.md §4
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

import { db, schema } from './mocks/nuxthub-db'
import { makeEvent, signIn, type FakeEvent } from './setup'
import { seedDepartments, seedLead, seedModule, seedRecord, seedUser } from './helpers/fixtures'
import { eq } from 'drizzle-orm'
import askHandler from '../server/api/module-requests/index.post'
import listHandler from '../server/api/module-requests/index.get'
import withdrawHandler from '../server/api/module-requests/[id]/index.delete'
import declineHandler from '../server/api/module-requests/[id]/decline.post'
import scheduleHandler from '../server/api/sessions/schedule.post'
import openHandler from '../server/api/sessions/[id]/open.post'

const sent = vi.hoisted(() => [] as { to: string, subject: string }[])

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
  await seedModule('TECH-111', { name: 'Rigging' })
  await seedModule('TECH-112', { name: 'Desk' })
  await seedModule('STGE-101', { name: 'Get-ins' })
  await seedModule('TECH-900', { name: 'Withdrawn kit', status: 'RETIRED' })

  await seedUser('trainer', 'A Trainer')
  await seedUser('techlead', 'Tech Lead')
  await seedUser('alice', 'Alice Adams')
  await seedUser('bob', 'Bob Barnes')
  await seedRecord({ userId: 'trainer', moduleId: 'LEAD-CERT', expiresAt: null })
  await seedLead('TECH', 'techlead')
}

async function ask(userId: string, moduleId: string, note?: string) {
  const event = makeEvent({ method: 'POST', path: '/api/module-requests', body: { moduleId, note } })
  signIn(event, { id: userId })
  return call(askHandler, event) as Promise<{ id: string }>
}

async function listFor(userId: string) {
  const event = makeEvent({ method: 'GET', path: '/api/module-requests' })
  signIn(event, { id: userId })
  return call(listHandler, event) as Promise<{
    mine: { moduleId: string, status: string }[]
    board: { moduleId: string, openCount: number, requesters: { name: string }[] }[]
    canSeeBoard: boolean
  }>
}

beforeEach(setup)

describe('asking', () => {
  it('records a request and shows it back', async () => {
    await ask('alice', 'TECH-111', 'Any evening')
    const view = await listFor('alice')

    expect(view.mine).toHaveLength(1)
    expect(view.mine[0]).toMatchObject({ moduleId: 'TECH-111', status: 'OPEN' })
  })

  it('refuses a second open request for the same module', async () => {
    await ask('alice', 'TECH-111')
    await expect(ask('alice', 'TECH-111')).rejects.toMatchObject({ statusCode: 409 })
  })

  it('allows asking again after withdrawing', async () => {
    const { id } = await ask('alice', 'TECH-111')

    const withdrawal = makeEvent({ method: 'DELETE', path: '/x', params: { id } })
    signIn(withdrawal, { id: 'alice' })
    await call(withdrawHandler, withdrawal)

    await expect(ask('alice', 'TECH-111')).resolves.toBeDefined()
  })

  it('refuses a retired module', async () => {
    await expect(ask('alice', 'TECH-900')).rejects.toMatchObject({ statusCode: 400 })
  })

  it('will not let somebody withdraw another person\'s request', async () => {
    const { id } = await ask('alice', 'TECH-111')
    const event = makeEvent({ method: 'DELETE', path: '/x', params: { id } })
    signIn(event, { id: 'bob' })
    await expect(call(withdrawHandler, event)).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('the demand board', () => {
  it('is hidden from an ordinary member', async () => {
    await ask('alice', 'TECH-111')
    const view = await listFor('alice')

    expect(view.canSeeBoard).toBe(false)
    expect(view.board).toHaveLength(0)
  })

  it('counts and names the people waiting, busiest first', async () => {
    await ask('alice', 'TECH-111')
    await ask('bob', 'TECH-111')
    await ask('alice', 'TECH-112')

    const view = await listFor('techlead')

    expect(view.canSeeBoard).toBe(true)
    expect(view.board[0]).toMatchObject({ moduleId: 'TECH-111', openCount: 2 })
    expect(view.board[0]!.requesters.map(person => person.name).sort())
      .toEqual(['Alice Adams', 'Bob Barnes'])
    expect(view.board[1]).toMatchObject({ moduleId: 'TECH-112', openCount: 1 })
  })

  it('shows a lead only their own departments', async () => {
    await ask('alice', 'TECH-111')
    await ask('alice', 'STGE-101')

    const view = await listFor('techlead')
    expect(view.board.map(row => row.moduleId)).toEqual(['TECH-111'])
  })
})

describe('resolving', () => {
  it('closes matching requests when a session is opened for sign-ups', async () => {
    await ask('alice', 'TECH-111')
    await ask('bob', 'TECH-111')

    const event = makeEvent({ method: 'POST', path: '/api/sessions/schedule', body: {
      heldOn: tomorrow(),
      moduleIds: ['TECH-111'],
      openNow: true,
    } })
    signIn(event, { id: 'trainer' })
    const result = await call(scheduleHandler, event) as { requestsAnswered: number }

    expect(result.requestsAnswered).toBe(2)
    const view = await listFor('alice')
    expect(view.mine[0]!.status).toBe('SCHEDULED')
  })

  it('leaves them open while the session is only planned', async () => {
    await ask('alice', 'TECH-111')

    const create = makeEvent({ method: 'POST', path: '/api/sessions/schedule', body: {
      heldOn: tomorrow(),
      moduleIds: ['TECH-111'],
    } })
    signIn(create, { id: 'trainer' })
    const { id, requestsAnswered } = await call(scheduleHandler, create) as {
      id: string
      requestsAnswered: number
    }

    // Nobody can see a planned session, so it has answered nobody.
    expect(requestsAnswered).toBe(0)
    expect((await listFor('alice')).mine[0]!.status).toBe('OPEN')

    const open = makeEvent({ method: 'POST', path: '/x', params: { id } })
    signIn(open, { id: 'trainer' })
    await call(openHandler, open)

    expect((await listFor('alice')).mine[0]!.status).toBe('SCHEDULED')
  })

  it('tells the people who asked, once it is actually offered', async () => {
    await ask('alice', 'TECH-111')
    await ask('bob', 'TECH-111')
    sent.length = 0

    const event = makeEvent({ method: 'POST', path: '/api/sessions/schedule', body: {
      heldOn: tomorrow(),
      moduleIds: ['TECH-111'],
      openNow: true,
    } })
    signIn(event, { id: 'trainer' })
    await call(scheduleHandler, event)

    expect(sent.map(mail => mail.to).sort()).toEqual([
      'alice@dev.newtheatre.org.uk',
      'bob@dev.newtheatre.org.uk',
    ])
    expect(sent[0]!.subject).toContain('Now scheduled')
  })

  it('leaves requests for other modules alone', async () => {
    await ask('alice', 'TECH-111')
    await ask('alice', 'TECH-112')

    const event = makeEvent({ method: 'POST', path: '/api/sessions/schedule', body: {
      heldOn: tomorrow(),
      moduleIds: ['TECH-111'],
      openNow: true,
    } })
    signIn(event, { id: 'trainer' })
    await call(scheduleHandler, event)

    const view = await listFor('alice')
    expect(view.mine.find(request => request.moduleId === 'TECH-112')!.status).toBe('OPEN')
  })

  it('lets a lead decline with a reason the requester sees', async () => {
    const { id } = await ask('alice', 'TECH-111')

    const event = makeEvent({
      method: 'POST',
      path: '/x',
      params: { id },
      body: { reason: 'The rig is out of action until the spring' },
    })
    signIn(event, { id: 'techlead' })
    await call(declineHandler, event)

    const row = await db.select().from(schema.moduleRequests)
      .where(eq(schema.moduleRequests.id, id)).get()
    expect(row!.status).toBe('DECLINED')
    expect(row!.declineReason).toContain('rig is out of action')
  })

  it('will not let a lead decline another department\'s request', async () => {
    const { id } = await ask('alice', 'STGE-101')
    const event = makeEvent({
      method: 'POST',
      path: '/x',
      params: { id },
      body: { reason: 'Not mine to answer' },
    })
    signIn(event, { id: 'techlead' })
    await expect(call(declineHandler, event)).rejects.toMatchObject({ statusCode: 403 })
  })
})
