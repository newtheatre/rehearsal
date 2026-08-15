/**
 * Reading the audit log: that it filters and pages correctly, and never
 * becomes a way to change anything.
 */

import { describe, it, expect } from 'vitest'
import auditHandler from '../server/api/admin/audit.get'
import { db, schema } from './mocks/nuxthub-db'
import { makeEvent, signIn, type FakeEvent } from './setup'
import { seedUser } from './helpers/fixtures'

type Handler = (event: FakeEvent) => Promise<unknown>
const call = (handler: unknown, event: FakeEvent) => (handler as Handler)(event)

interface AuditResponse {
  entries: {
    id: string
    action: string
    target: string
    actorName: string | null
    detail: unknown
    createdAt: Date
  }[]
  actions: string[]
  hasMore: boolean
}

async function setup() {
  await seedUser('tm', 'Theatre Manager')
  await seedUser('ctd', 'The CTD')

  const base = Date.now() - 10_000
  const rows = [
    { actorUserId: 'tm', action: 'module.create', target: 'TECH-111', detail: '{"name":"Rigging"}' },
    { actorUserId: 'ctd', action: 'record.signoff', target: 'rec-1', detail: '{"moduleId":"LD-CERT"}' },
    { actorUserId: 'tm', action: 'record.revoke', target: 'rec-2', detail: '{"reason":"Wrong person"}' },
    { actorUserId: null, action: 'expiry.sweep', target: '2026-08-14', detail: '{"mode":"dry-run"}' },
  ]
  for (const [i, row] of rows.entries()) {
    await db.insert(schema.auditLog).values({ ...row, createdAt: new Date(base + i * 1000) })
  }
}

function adminEvent(query: Record<string, unknown> = {}) {
  const event = makeEvent({ path: '/api/admin/audit', query })
  signIn(event, { id: 'tm', roles: ['training:ADMIN'] })
  return event
}

describe('reading the audit log', () => {
  it('returns newest first with the actor resolved to a name', async () => {
    await setup()
    const result = await call(auditHandler, adminEvent()) as AuditResponse

    expect(result.entries[0]!.action).toBe('expiry.sweep')
    expect(result.entries.find(e => e.action === 'record.signoff')!.actorName).toBe('The CTD')
  })

  it('shows a cron entry as system rather than blank', async () => {
    await setup()
    const result = await call(auditHandler, adminEvent()) as AuditResponse

    // "system" is a meaningful answer; an empty cell isn't.
    const sweep = result.entries.find(e => e.action === 'expiry.sweep')!
    expect(sweep.actorName).toBeNull()
    expect(sweep.actorUserId).toBeNull()
  })

  it('parses detail into JSON rather than handing back a string', async () => {
    await setup()
    const result = await call(auditHandler, adminEvent()) as AuditResponse

    const revoke = result.entries.find(e => e.action === 'record.revoke')!
    expect(revoke.detail).toEqual({ reason: 'Wrong person' })
  })

  it('filters by action and by actor', async () => {
    await setup()

    const byAction = await call(auditHandler, adminEvent({ action: 'record.revoke' })) as AuditResponse
    expect(byAction.entries).toHaveLength(1)

    const byActor = await call(auditHandler, adminEvent({ actor: 'ctd' })) as AuditResponse
    expect(byActor.entries.map(e => e.action)).toEqual(['record.signoff'])
  })

  it('searches target and detail', async () => {
    await setup()

    const byTarget = await call(auditHandler, adminEvent({ q: 'TECH-111' })) as AuditResponse
    expect(byTarget.entries).toHaveLength(1)

    const byDetail = await call(auditHandler, adminEvent({ q: 'Wrong person' })) as AuditResponse
    expect(byDetail.entries.map(e => e.action)).toEqual(['record.revoke'])
  })

  it('lists the distinct actions for the filter', async () => {
    await setup()
    const result = await call(auditHandler, adminEvent()) as AuditResponse

    expect(result.actions).toEqual(['expiry.sweep', 'module.create', 'record.revoke', 'record.signoff'])
  })

  it('pages without dropping or repeating an entry', async () => {
    await setup()

    const first = await call(auditHandler, adminEvent({ limit: 2 })) as AuditResponse
    expect(first.entries).toHaveLength(2)
    expect(first.hasMore).toBe(true)

    const cursor = new Date(first.entries[1]!.createdAt).getTime()
    const second = await call(auditHandler, adminEvent({ limit: 2, before: cursor })) as AuditResponse

    expect(second.entries).toHaveLength(2)
    expect(second.hasMore).toBe(false)

    const ids = [...first.entries, ...second.entries].map(e => e.id)
    expect(new Set(ids).size).toBe(4)
  })

  it('is admin-only', async () => {
    await setup()
    const event = makeEvent({ path: '/api/admin/audit' })
    signIn(event, { id: 'ctd' })

    await expect(call(auditHandler, event)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('reads without writing', async () => {
    await setup()
    const before = await db.select().from(schema.auditLog).all()

    await call(auditHandler, adminEvent())

    // Viewing the log must not itself be an auditable event, or the log
    // becomes mostly a record of people looking at it.
    expect(await db.select().from(schema.auditLog).all()).toHaveLength(before.length)
  })
})
