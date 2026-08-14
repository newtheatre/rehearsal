/**
 * Catalogue mutations: who may write, and the rules that must hold however a
 * module is created or edited. These run the real handlers.
 */

import { describe, it, expect } from 'vitest'
import createModule from '../server/api/modules/index.post'
import updateModule from '../server/api/modules/[id].put'
import { db, schema } from './mocks/nuxthub-db'
import { eq } from 'drizzle-orm'
import { makeEvent, signIn, type FakeEvent } from './setup'
import { seedDepartments, seedLead, seedModule, seedUser } from './helpers/fixtures'

type Handler = (event: FakeEvent) => Promise<unknown>

async function call(handler: unknown, event: FakeEvent) {
  return (handler as Handler)(event)
}

const validModule = {
  id: 'TECH-161',
  department: 'TECH',
  name: 'Haze and Smoke Machines',
  expiryMode: 'NONE' as const,
  prerequisites: [] as string[],
}

async function setup() {
  await seedDepartments()
  await seedUser('member')
  await seedUser('ctd')
  await seedUser('tm')
  await seedLead('TECH', 'ctd')
}

function postEvent(body: unknown) {
  return makeEvent({ method: 'POST', path: '/api/modules', body })
}

function putEvent(id: string, body: unknown) {
  return makeEvent({ method: 'PUT', path: `/api/modules/${id}`, params: { id }, body })
}

describe('POST /api/modules — authorisation', () => {
  it('refuses an ordinary member', async () => {
    await setup()
    const event = postEvent(validModule)
    signIn(event, { id: 'member' })

    await expect(call(createModule, event)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('refuses a lead outside their own department', async () => {
    await setup()
    const event = postEvent({ ...validModule, id: 'STGE-161', department: 'STGE' })
    signIn(event, { id: 'ctd' })

    await expect(call(createModule, event)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('allows a lead in their own department', async () => {
    await setup()
    const event = postEvent(validModule)
    signIn(event, { id: 'ctd' })

    await call(createModule, event)
    const created = await db.select().from(schema.modules).where(eq(schema.modules.id, 'TECH-161')).get()
    expect(created?.name).toBe('Haze and Smoke Machines')
    expect(created?.status).toBe('DRAFT') // new modules are never born published
  })

  it('allows an admin anywhere, but only with a fresh session', async () => {
    await setup()
    const stale = postEvent({ ...validModule, id: 'STGE-161', department: 'STGE' })
    signIn(stale, { id: 'tm', roles: ['training:ADMIN'] }, { refreshedAt: Date.now() - 20 * 60_000 })

    // A stale session may be missing a revoked role — refresh before honouring it.
    await expect(call(createModule, stale)).rejects.toMatchObject({
      statusCode: 401,
      data: { stale: true },
    })

    const fresh = postEvent({ ...validModule, id: 'STGE-161', department: 'STGE' })
    signIn(fresh, { id: 'tm', roles: ['training:ADMIN'] })
    await call(createModule, fresh)

    expect(await db.select().from(schema.modules).where(eq(schema.modules.id, 'STGE-161')).get()).toBeTruthy()
  })
})

describe('POST /api/modules — validation', () => {
  it('rejects an id whose prefix contradicts the department', async () => {
    await setup()
    const event = postEvent({ ...validModule, department: 'NNT' })
    signIn(event, { id: 'tm', roles: ['training:ADMIN'] })

    await expect(call(createModule, event)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('exempts certifications, which legitimately sit in another department', async () => {
    await setup()
    const event = postEvent({
      id: 'LD-CERT',
      department: 'TECH',
      kind: 'CERTIFICATION',
      name: 'Lighting Designer',
      expiryMode: 'NONE',
    })
    signIn(event, { id: 'ctd' })

    await call(createModule, event)
    const created = await db.select().from(schema.modules).where(eq(schema.modules.id, 'LD-CERT')).get()
    expect(created?.department).toBe('TECH')
    expect(created?.signoffRequired).toBe(true)
  })

  it('rejects a duplicate id', async () => {
    await setup()
    await seedModule('TECH-161')
    const event = postEvent(validModule)
    signIn(event, { id: 'ctd' })

    await expect(call(createModule, event)).rejects.toMatchObject({ statusCode: 409 })
  })

  it('rejects an unknown prerequisite', async () => {
    await setup()
    const event = postEvent({ ...validModule, prerequisites: ['TECH-999'] })
    signIn(event, { id: 'ctd' })

    await expect(call(createModule, event)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects a months-based expiry with no interval', async () => {
    await setup()
    const event = postEvent({ ...validModule, expiryMode: 'MONTHS' })
    signIn(event, { id: 'ctd' })

    await expect(call(createModule, event)).rejects.toThrow()
  })
})

describe('kind rules', () => {
  it('never lets a plain module require sign-off or confer standing', async () => {
    await setup()
    const event = postEvent({ ...validModule, grantsTrainer: true, grantsSupervisor: true })
    signIn(event, { id: 'ctd' })

    await call(createModule, event)
    const created = await db.select().from(schema.modules).where(eq(schema.modules.id, 'TECH-161')).get()
    expect(created?.signoffRequired).toBe(false)
    expect(created?.grantsTrainer).toBe(false)
    expect(created?.grantsSupervisor).toBe(false)
  })

  it('forces a brief to never expire and to confer nothing', async () => {
    await setup()
    const event = postEvent({
      ...validModule,
      kind: 'BRIEF',
      expiryMode: 'MONTHS',
      expiryMonths: 12,
      grantsTrainer: true,
    })
    signIn(event, { id: 'ctd' })

    await call(createModule, event)
    const created = await db.select().from(schema.modules).where(eq(schema.modules.id, 'TECH-161')).get()
    expect(created?.expiryMode).toBe('NONE')
    expect(created?.expiryMonths).toBeNull()
    expect(created?.grantsTrainer).toBe(false)
  })

  it('strips standing when a certification is demoted to a module', async () => {
    await setup()
    await seedModule('LD-CERT', {
      department: 'TECH',
      kind: 'CERTIFICATION',
      signoffRequired: true,
      grantsSupervisor: true,
    })

    const event = putEvent('LD-CERT', { kind: 'MODULE' })
    signIn(event, { id: 'ctd' })
    await call(updateModule, event)

    const updated = await db.select().from(schema.modules).where(eq(schema.modules.id, 'LD-CERT')).get()
    expect(updated?.signoffRequired).toBe(false)
    expect(updated?.grantsSupervisor).toBe(false)
  })
})

describe('PUT /api/modules/:id', () => {
  it('refuses to move a module into a department the lead does not steward', async () => {
    await setup()
    await seedModule('TECH-161')
    const event = putEvent('TECH-161', { department: 'STGE' })
    signIn(event, { id: 'ctd' })

    await expect(call(updateModule, event)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('refuses a lead editing another department’s module', async () => {
    await setup()
    await seedModule('STGE-101')
    const event = putEvent('STGE-101', { name: 'Renamed' })
    signIn(event, { id: 'ctd' })

    await expect(call(updateModule, event)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('rejects a prerequisite cycle', async () => {
    await setup()
    await seedModule('TECH-111')
    await seedModule('TECH-211')
    await db.insert(schema.modulePrerequisites).values({ moduleId: 'TECH-211', requiresModuleId: 'TECH-111' })

    const event = putEvent('TECH-111', { prerequisites: ['TECH-211'] })
    signIn(event, { id: 'ctd' })

    await expect(call(updateModule, event)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('replaces the prerequisite set, so removals actually remove', async () => {
    await setup()
    await seedModule('TECH-111')
    await seedModule('TECH-112')
    await seedModule('TECH-211')
    await db.insert(schema.modulePrerequisites).values({ moduleId: 'TECH-211', requiresModuleId: 'TECH-111' })

    const event = putEvent('TECH-211', { prerequisites: ['TECH-112'] })
    signIn(event, { id: 'ctd' })
    await call(updateModule, event)

    const rows = await db.select().from(schema.modulePrerequisites)
      .where(eq(schema.modulePrerequisites.moduleId, 'TECH-211')).all()
    expect(rows.map(r => r.requiresModuleId)).toEqual(['TECH-112'])
  })

  it('publishes a draft', async () => {
    await setup()
    await seedModule('TECH-161', { status: 'DRAFT' })
    const event = putEvent('TECH-161', { status: 'ACTIVE' })
    signIn(event, { id: 'ctd' })
    await call(updateModule, event)

    const updated = await db.select().from(schema.modules).where(eq(schema.modules.id, 'TECH-161')).get()
    expect(updated?.status).toBe('ACTIVE')
  })
})

describe('audit trail', () => {
  it('records creates and updates with the actor and a diff', async () => {
    await setup()

    const create = postEvent(validModule)
    signIn(create, { id: 'ctd' })
    await call(createModule, create)

    const update = putEvent('TECH-161', { status: 'ACTIVE' })
    signIn(update, { id: 'ctd' })
    await call(updateModule, update)

    const entries = await db.select().from(schema.auditLog).all()
    expect(entries.map(e => e.action)).toEqual(['module.create', 'module.update'])
    expect(entries.every(e => e.actorUserId === 'ctd')).toBe(true)

    const diff = JSON.parse(entries[1]!.detail!)
    expect(diff.changed.status).toEqual({ from: 'DRAFT', to: 'ACTIVE' })
  })
})
