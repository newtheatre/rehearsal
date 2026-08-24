/**
 * Managing department leads: that the authority starts and stops exactly when
 * the row does.
 */

import { today } from '../shared/utils/dates'

import { describe, it, expect } from 'bun:test'
import listHandler from '../server/api/admin/leads/index.get'
import addHandler from '../server/api/admin/leads/index.post'
import removeHandler from '../server/api/admin/leads/[id].delete'
import signoffHandler from '../server/api/people/[id]/signoff.post'
import { db, schema } from './mocks/nuxthub-db'
import { eq } from 'drizzle-orm'
import { getAbilities } from '../server/utils/abilities'
import { makeEvent, signIn, type FakeEvent } from './setup'
import { seedDepartments, seedModule, seedRecord, seedUser } from './helpers/fixtures'

type Handler = (event: FakeEvent) => Promise<unknown>
const call = (handler: unknown, event: FakeEvent) => (handler as Handler)(event)

const TODAY = today()

async function setup() {
  await seedDepartments()
  await seedUser('tm', 'Theatre Manager')
  await seedUser('ctd', 'The CTD')
  await seedUser('alice', 'Alice')
  await seedModule('TECH-111', { name: 'Rigging' })
  await seedModule('LD-CERT', {
    department: 'TECH',
    kind: 'CERTIFICATION',
    name: 'Lighting Designer',
    signoffRequired: true,
  })
}

function adminEvent(overrides: Partial<FakeEvent> = {}) {
  const event = makeEvent(overrides)
  signIn(event, { id: 'tm', roles: ['training:ADMIN'] })
  return event
}

describe('listing leads', () => {
  it('includes departments that have none, that is the useful answer', async () => {
    await setup()
    const result = await call(listHandler, adminEvent()) as {
      departments: { code: string, leads: unknown[] }[]
    }

    expect(result.departments.length).toBeGreaterThan(1)
    expect(result.departments.every(d => Array.isArray(d.leads))).toBe(true)
  })

  it('is admin-only', async () => {
    await setup()
    const event = makeEvent()
    signIn(event, { id: 'alice' })
    await expect(call(listHandler, event)).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('adding a lead', () => {
  function addEvent(body: unknown) {
    return adminEvent({ method: 'POST', path: '/api/admin/leads', body })
  }

  it('grants stewardship immediately', async () => {
    await setup()

    const before = await getAbilities({
      id: 'ctd', email: 'ctd@x', name: 'The CTD', verified: true, guest: false, roles: [],
    })
    expect(before.leadOf).toEqual([])

    await call(addHandler, addEvent({ department: 'TECH', userId: 'ctd' }))

    const after = await getAbilities({
      id: 'ctd', email: 'ctd@x', name: 'The CTD', verified: true, guest: false, roles: [],
    })
    expect(after.leadOf).toEqual(['TECH'])
  })

  it('lets the new lead sign off in their department', async () => {
    await setup()
    await seedRecord({ userId: 'alice', moduleId: 'TECH-111', expiresAt: null })
    await db.insert(schema.modulePrerequisites)
      .values({ moduleId: 'LD-CERT', requiresModuleId: 'TECH-111' })

    const before = adminEvent({
      method: 'POST',
      path: '/api/people/alice/signoff',
      params: { id: 'alice' },
      body: { moduleId: 'LD-CERT', awardedAt: TODAY },
    })
    signIn(before, { id: 'ctd' })
    await expect(call(signoffHandler, before)).rejects.toMatchObject({ statusCode: 403 })

    await call(addHandler, addEvent({ department: 'TECH', userId: 'ctd' }))

    const after = makeEvent({
      method: 'POST',
      path: '/api/people/alice/signoff',
      params: { id: 'alice' },
      body: { moduleId: 'LD-CERT', awardedAt: TODAY },
    })
    signIn(after, { id: 'ctd' })
    await call(signoffHandler, after)

    expect(await db.select().from(schema.records)
      .where(eq(schema.records.moduleId, 'LD-CERT')).all()).toHaveLength(1)
  })

  it('is idempotent', async () => {
    await setup()
    await call(addHandler, addEvent({ department: 'TECH', userId: 'ctd' }))
    const second = await call(addHandler, addEvent({ department: 'TECH', userId: 'ctd' })) as { alreadyLead?: boolean }

    expect(second.alreadyLead).toBe(true)
    expect(await db.select().from(schema.departmentLeads).all()).toHaveLength(1)
  })

  it('supports several leads for one department', async () => {
    await setup()
    await call(addHandler, addEvent({ department: 'TECH', userId: 'ctd' }))
    await call(addHandler, addEvent({ department: 'TECH', userId: 'alice' }))

    expect(await db.select().from(schema.departmentLeads).all()).toHaveLength(2)
  })

  it('explains that someone unknown simply has not signed in yet', async () => {
    await setup()
    await expect(call(addHandler, addEvent({ department: 'TECH', userId: 'never-seen' })))
      .rejects.toMatchObject({
        statusCode: 400,
        statusMessage: expect.stringContaining('sign in'),
      })
  })

  it('rejects an unknown department', async () => {
    await setup()
    await expect(call(addHandler, addEvent({ department: 'NOPE', userId: 'ctd' })))
      .rejects.toMatchObject({ statusCode: 400 })
  })

  it('is admin-only', async () => {
    await setup()
    const event = makeEvent({ method: 'POST', path: '/api/admin/leads', body: { department: 'TECH', userId: 'ctd' } })
    signIn(event, { id: 'alice' })
    await expect(call(addHandler, event)).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('removing a lead', () => {
  it('ends authority immediately, keeping what they signed off', async () => {
    await setup()
    await seedRecord({ userId: 'alice', moduleId: 'TECH-111', expiresAt: null })

    const added = await call(addHandler, adminEvent({
      method: 'POST', path: '/api/admin/leads', body: { department: 'TECH', userId: 'ctd' },
    })) as { id: string }

    // Something they signed off while they held the role.
    await seedRecord({ userId: 'alice', moduleId: 'LD-CERT', expiresAt: null, source: 'SIGNOFF', grantedBy: 'ctd' })

    await call(removeHandler, adminEvent({
      method: 'DELETE', path: `/api/admin/leads/${added.id}`, params: { id: added.id },
    }))

    const abilities = await getAbilities({
      id: 'ctd', email: 'ctd@x', name: 'The CTD', verified: true, guest: false, roles: [],
    })
    expect(abilities.leadOf).toEqual([])

    // The record stays, still attributed to them: that is where the history
    // belongs, not in a stale authority row.
    const record = await db.select().from(schema.records)
      .where(eq(schema.records.moduleId, 'LD-CERT')).get()
    expect(record!.grantedBy).toBe('ctd')
  })

  it('404s an id that is not a current lead', async () => {
    await setup()
    await expect(call(removeHandler, adminEvent({
      method: 'DELETE', path: '/api/admin/leads/nope', params: { id: 'nope' },
    }))).rejects.toMatchObject({ statusCode: 404 })
  })

  it('is admin-only', async () => {
    await setup()
    const added = await call(addHandler, adminEvent({
      method: 'POST', path: '/api/admin/leads', body: { department: 'TECH', userId: 'ctd' },
    })) as { id: string }

    const event = makeEvent({ method: 'DELETE', path: `/api/admin/leads/${added.id}`, params: { id: added.id } })
    signIn(event, { id: 'ctd' })

    // A lead cannot remove themselves or anyone else: that is the TM's job.
    await expect(call(removeHandler, event)).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('audit', () => {
  it('records both directions with the department and person', async () => {
    await setup()
    const added = await call(addHandler, adminEvent({
      method: 'POST', path: '/api/admin/leads', body: { department: 'TECH', userId: 'ctd' },
    })) as { id: string }

    await call(removeHandler, adminEvent({
      method: 'DELETE', path: `/api/admin/leads/${added.id}`, params: { id: added.id },
    }))

    const entries = await db.select().from(schema.auditLog).all()
    expect(entries.map(e => e.action)).toEqual(['lead.add', 'lead.remove'])
    expect(entries.every(e => e.actorUserId === 'tm')).toBe(true)
    expect(JSON.parse(entries[0]!.detail!)).toMatchObject({ department: 'TECH', userId: 'ctd' })
  })
})
