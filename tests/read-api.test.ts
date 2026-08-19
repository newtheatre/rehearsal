/**
 * The consumer read API: token auth, payload discipline, and that granting or
 * revoking a required module flips eligibility.
 */

import { describe, it, expect } from 'vitest'
import modulesHandler from '../server/api/v1/modules.get'
import userRecordsHandler from '../server/api/v1/users/[id]/records.get'
import recordsHandler from '../server/api/v1/records.get'
import eligibilityHandler from '../server/api/v1/eligibility/[key].get'
import rulesHandler from '../server/api/admin/eligibility-rules/index.put'
import tokensHandler from '../server/api/admin/service-tokens/index.post'
import { db, schema } from './mocks/nuxthub-db'
import consumerMiddleware from '../server/middleware/consumer-api'
import hooksMiddleware from '../server/middleware/hooks'
import { eq } from 'drizzle-orm'
import { createServiceToken, hashServiceToken } from '../server/utils/serviceToken'
import { makeEvent, signIn, type FakeEvent } from './setup'
import { seedDepartments, seedModule, seedRecord, seedUser } from './helpers/fixtures'

type Handler = (event: FakeEvent) => Promise<unknown>
const call = (handler: unknown, event: FakeEvent) => (handler as Handler)(event)

let token: string

async function setup() {
  await seedDepartments()
  await seedModule('NNT-001', { name: 'Induction', expiryMode: 'ACADEMIC_YEAR' })
  await seedModule('ADMN-101', { department: 'NNT', name: 'Front of House Management' })
  await seedModule('SFTY-002', { department: 'NNT', name: 'Fire Procedure' })
  await seedModule('NNT-002', { name: 'Get-In Brief', kind: 'BRIEF' })
  await seedModule('TECH-112', { department: 'TECH', name: 'Desk', status: 'DRAFT' })

  await seedUser('alice', 'Alice Anderson')
  await seedUser('bob', 'Bob Brown')
  await seedUser('tm', 'Theatre Manager')

  token = (await createServiceToken('proscenium-rota')).token

  await db.insert(schema.eligibilityRules).values({
    key: 'duty-manager',
    name: 'Duty manager',
    requires: JSON.stringify({ allOf: ['NNT-001', 'ADMN-101', 'SFTY-002'], anyOf: [] }),
  })
}

function apiEvent(path: string, options: {
  bearer?: string
  query?: Record<string, unknown>
  params?: Record<string, string>
} = {}) {
  return makeEvent({
    path,
    headers: options.bearer === undefined ? {} : { authorization: `Bearer ${options.bearer}` },
    query: options.query,
    params: options.params,
  })
}

describe('subtree middleware', () => {
  it('refuses an unauthenticated /api/v1 request before any route runs', async () => {
    await setup()
    const event = apiEvent('/api/v1/modules')

    await expect(call(consumerMiddleware, event)).rejects.toMatchObject({ statusCode: 401 })
  })

  it('lets a valid token through and sets the consumer cache header', async () => {
    await setup()
    const event = apiEvent('/api/v1/modules', { bearer: token })

    await expect(call(consumerMiddleware, event)).resolves.toBeUndefined()
  })

  it('ignores paths outside its subtree', async () => {
    await setup()
    const event = apiEvent('/api/modules')

    await expect(call(consumerMiddleware, event)).resolves.toBeUndefined()
  })

  it('refuses an unauthenticated hook request', async () => {
    await setup()
    const event = makeEvent({ method: 'POST', path: '/api/_hooks/auth/anonymise', headers: {} })

    // Synchronous guard, so it throws rather than rejecting.
    await expect(async () => call(hooksMiddleware, event)).rejects.toMatchObject({ statusCode: 401 })
  })
})

describe('token authentication', () => {
  it('refuses a request with no token', async () => {
    await setup()
    await expect(call(modulesHandler, apiEvent('/api/v1/modules')))
      .rejects.toMatchObject({ statusCode: 401 })
  })

  it('refuses a wrong token', async () => {
    await setup()
    await expect(call(modulesHandler, apiEvent('/api/v1/modules', { bearer: 'nnt_trn_not-a-real-token' })))
      .rejects.toMatchObject({ statusCode: 401 })
  })

  it('refuses another app’s token prefix', async () => {
    await setup()
    // An auth-service token pasted into the wrong secret should fail loudly.
    await expect(call(modulesHandler, apiEvent('/api/v1/modules', { bearer: 'nnt_svc_something' })))
      .rejects.toMatchObject({ statusCode: 401 })
  })

  it('accepts a valid token and stamps last_used_at', async () => {
    await setup()
    await call(modulesHandler, apiEvent('/api/v1/modules', { bearer: token }))

    const row = await db.select().from(schema.serviceTokens).get()
    expect(row!.lastUsedAt).not.toBeNull()
  })

  it('stores only the hash, never the token', async () => {
    await setup()
    const row = await db.select().from(schema.serviceTokens).get()

    expect(row!.tokenHash).toBe(hashServiceToken(token))
    expect(JSON.stringify(row)).not.toContain(token)
  })

  it('refuses a token whose scope does not cover the request', async () => {
    await setup()
    await db.update(schema.serviceTokens).set({ scopes: 'something-else' })

    await expect(call(modulesHandler, apiEvent('/api/v1/modules', { bearer: token })))
      .rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('GET /api/v1/modules', () => {
  it('returns ACTIVE modules only by default', async () => {
    await setup()
    const modules = await call(modulesHandler, apiEvent('/api/v1/modules', { bearer: token })) as { id: string }[]

    expect(modules.map(m => m.id)).not.toContain('TECH-112')
    expect(modules.map(m => m.id)).toContain('NNT-001')
  })

  it('includes drafts only when explicitly asked', async () => {
    await setup()
    const all = await call(modulesHandler, apiEvent('/api/v1/modules', {
      bearer: token, query: { status: 'all' },
    })) as { id: string }[]

    expect(all.map(m => m.id)).toContain('TECH-112')
  })
})

describe('GET /api/v1/users/:id/records', () => {
  it('never includes an email address', async () => {
    await setup()
    await seedRecord({ userId: 'alice', moduleId: 'NNT-001', expiresAt: '2027-09-30' })

    const result = await call(userRecordsHandler, apiEvent('/api/v1/users/alice/records', {
      bearer: token, params: { id: 'alice' },
    }))

    // Invariant 8: consumers get ids and names, never emails.
    expect(JSON.stringify(result)).not.toContain('@')
  })

  it('reports state for modules and last-attended for briefs', async () => {
    await setup()
    await seedRecord({ userId: 'alice', moduleId: 'NNT-001', expiresAt: '2027-09-30' })
    await seedRecord({ userId: 'alice', moduleId: 'NNT-002', awardedAt: '2026-08-01', expiresAt: null })

    const result = await call(userRecordsHandler, apiEvent('/api/v1/users/alice/records', {
      bearer: token, params: { id: 'alice' },
    })) as { records: Record<string, unknown>[] }

    const induction = result.records.find(r => r.module === 'NNT-001')!
    const brief = result.records.find(r => r.module === 'NNT-002')!

    expect(induction.state).toBe('VALID')
    // A brief has no validity to report: reporting one invites gating on it.
    expect(brief.state).toBeUndefined()
    expect(brief.lastAttended).toBe('2026-08-01')
  })

  it('404s an unknown user', async () => {
    await setup()
    await expect(call(userRecordsHandler, apiEvent('/api/v1/users/nobody/records', {
      bearer: token, params: { id: 'nobody' },
    }))).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('GET /api/v1/records', () => {
  it('lists current holders and excludes expired by default', async () => {
    await setup()
    await seedRecord({ userId: 'alice', moduleId: 'ADMN-101', expiresAt: null })
    await seedRecord({ userId: 'bob', moduleId: 'ADMN-101', expiresAt: '2020-01-01' })

    const result = await call(recordsHandler, apiEvent('/api/v1/records', {
      bearer: token, query: { module: 'ADMN-101' },
    })) as { users: { id: string }[] }

    expect(result.users.map(u => u.id)).toEqual(['alice'])
  })

  it('can be asked for everyone, expired included', async () => {
    await setup()
    await seedRecord({ userId: 'alice', moduleId: 'ADMN-101', expiresAt: null })
    await seedRecord({ userId: 'bob', moduleId: 'ADMN-101', expiresAt: '2020-01-01' })

    const result = await call(recordsHandler, apiEvent('/api/v1/records', {
      bearer: token, query: { module: 'ADMN-101', state: 'all' },
    })) as { users: { id: string, state: string }[] }

    expect(result.users).toHaveLength(2)
    expect(result.users.find(u => u.id === 'bob')!.state).toBe('EXPIRED')
  })

  it('404s an unknown module', async () => {
    await setup()
    await expect(call(recordsHandler, apiEvent('/api/v1/records', {
      bearer: token, query: { module: 'ZZZ-999' },
    }))).rejects.toThrow()
  })
})

describe('GET /api/v1/eligibility/:key', () => {
  async function grantAll(userId: string) {
    for (const moduleId of ['NNT-001', 'ADMN-101', 'SFTY-002']) {
      await seedRecord({ userId, moduleId, expiresAt: null })
    }
  }

  it('reports exactly what is missing', async () => {
    await setup()
    await seedRecord({ userId: 'alice', moduleId: 'NNT-001', expiresAt: null })

    const result = await call(eligibilityHandler, apiEvent('/api/v1/eligibility/duty-manager', {
      bearer: token, params: { key: 'duty-manager' }, query: { userId: 'alice' },
    })) as { eligible: boolean, missing: string[] }

    expect(result.eligible).toBe(false)
    expect(result.missing.sort()).toEqual(['ADMN-101', 'SFTY-002'])
  })

  it('flips to eligible when the last module is granted', async () => {
    await setup()
    await grantAll('alice')

    const result = await call(eligibilityHandler, apiEvent('/api/v1/eligibility/duty-manager', {
      bearer: token, params: { key: 'duty-manager' }, query: { userId: 'alice' },
    })) as { eligible: boolean, missing: string[] }

    expect(result).toMatchObject({ eligible: true, missing: [] })
  })

  it('refuses to answer a rule it cannot read, rather than passing everyone', async () => {
    await setup()
    await db.update(schema.eligibilityRules)
      .set({ requires: 'not json at all' })
      .where(eq(schema.eligibilityRules.key, 'duty-manager'))

    await expect(call(eligibilityHandler, apiEvent('/api/v1/eligibility/duty-manager', {
      bearer: token, params: { key: 'duty-manager' }, query: { userId: 'alice' },
    }))).rejects.toMatchObject({ statusCode: 503 })
  })

  it('refuses a rule that requires nothing, in either shape', async () => {
    await setup()
    await db.update(schema.eligibilityRules)
      .set({ requires: JSON.stringify({ allOf: [], anyOf: [] }) })
      .where(eq(schema.eligibilityRules.key, 'duty-manager'))

    // Without a userId this would otherwise return the whole membership.
    await expect(call(eligibilityHandler, apiEvent('/api/v1/eligibility/duty-manager', {
      bearer: token, params: { key: 'duty-manager' },
    }))).rejects.toMatchObject({ statusCode: 503 })
  })

  it('flips back when a required module is revoked', async () => {
    await setup()
    await grantAll('alice')

    // The rota's claim gating rests on exactly this.
    await db.update(schema.records)
      .set({ revokedAt: new Date(), revokedBy: 'tm', revokeReason: 'Granted in error' })
      .where(eq(schema.records.moduleId, 'SFTY-002'))

    const result = await call(eligibilityHandler, apiEvent('/api/v1/eligibility/duty-manager', {
      bearer: token, params: { key: 'duty-manager' }, query: { userId: 'alice' },
    })) as { eligible: boolean, missing: string[] }

    expect(result.eligible).toBe(false)
    expect(result.missing).toEqual(['SFTY-002'])
  })

  it('flips back when a required module expires', async () => {
    await setup()
    await grantAll('alice')
    await db.update(schema.records).set({ expiresAt: '2020-01-01' })
      .where(eq(schema.records.moduleId, 'NNT-001'))

    const result = await call(eligibilityHandler, apiEvent('/api/v1/eligibility/duty-manager', {
      bearer: token, params: { key: 'duty-manager' }, query: { userId: 'alice' },
    })) as { eligible: boolean, missing: string[] }

    expect(result.eligible).toBe(false)
    expect(result.missing).toEqual(['NNT-001'])
  })

  it('stays eligible while a module is merely expiring, and says so', async () => {
    await setup()
    await grantAll('alice')
    const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10)
    await db.update(schema.records).set({ expiresAt: soon })
      .where(eq(schema.records.moduleId, 'ADMN-101'))

    const result = await call(eligibilityHandler, apiEvent('/api/v1/eligibility/duty-manager', {
      bearer: token, params: { key: 'duty-manager' }, query: { userId: 'alice' },
    })) as { eligible: boolean, expiring: { moduleId: string }[] }

    // Ability never flickers off early; the consumer gets the warning for free.
    expect(result.eligible).toBe(true)
    expect(result.expiring.map(e => e.moduleId)).toEqual(['ADMN-101'])
  })

  it('lists everyone eligible when no user is named', async () => {
    await setup()
    await grantAll('alice')

    const result = await call(eligibilityHandler, apiEvent('/api/v1/eligibility/duty-manager', {
      bearer: token, params: { key: 'duty-manager' },
    })) as { userIds: string[] }

    expect(result.userIds).toEqual(['alice'])
  })

  it('404s an unknown rule loudly, that is a configuration break', async () => {
    await setup()
    await expect(call(eligibilityHandler, apiEvent('/api/v1/eligibility/nope', {
      bearer: token, params: { key: 'nope' },
    }))).rejects.toMatchObject({ statusCode: 404 })
  })

  it('satisfies an anyOf rule with one of its options', async () => {
    await setup()
    await db.update(schema.eligibilityRules)
      .set({ requires: JSON.stringify({ allOf: ['NNT-001'], anyOf: ['ADMN-101', 'SFTY-002'] }) })
      .where(eq(schema.eligibilityRules.key, 'duty-manager'))

    await seedRecord({ userId: 'alice', moduleId: 'NNT-001', expiresAt: null })
    await seedRecord({ userId: 'alice', moduleId: 'SFTY-002', expiresAt: null })

    const result = await call(eligibilityHandler, apiEvent('/api/v1/eligibility/duty-manager', {
      bearer: token, params: { key: 'duty-manager' }, query: { userId: 'alice' },
    })) as { eligible: boolean }

    expect(result.eligible).toBe(true)
  })
})

describe('admin: rules and tokens', () => {
  function adminEvent(path: string, body: unknown) {
    const event = makeEvent({ method: 'PUT', path, body })
    signIn(event, { id: 'tm', roles: ['training:ADMIN'] })
    return event
  }

  it('refuses a rule referencing an unknown module', async () => {
    await setup()
    await expect(call(rulesHandler, adminEvent('/api/admin/eligibility-rules', {
      key: 'test', name: 'Test', requires: { allOf: ['ZZZ-999'], anyOf: [] },
    }))).rejects.toMatchObject({ statusCode: 400 })
  })

  it('refuses a rule containing a brief, which could never be satisfied', async () => {
    await setup()
    await expect(call(rulesHandler, adminEvent('/api/admin/eligibility-rules', {
      key: 'test', name: 'Test', requires: { allOf: ['NNT-002'], anyOf: [] },
    }))).rejects.toMatchObject({ statusCode: 400 })
  })

  it('refuses an empty rule, which would make everyone eligible', async () => {
    await setup()
    await expect(call(rulesHandler, adminEvent('/api/admin/eligibility-rules', {
      key: 'test', name: 'Test', requires: { allOf: [], anyOf: [] },
    }))).rejects.toMatchObject({ statusCode: 400 })
  })

  it('audits a rule change with the before and after', async () => {
    await setup()
    await call(rulesHandler, adminEvent('/api/admin/eligibility-rules', {
      key: 'duty-manager', name: 'Duty manager', requires: { allOf: ['NNT-001'], anyOf: [] },
    }))

    const [entry] = await db.select().from(schema.auditLog).all()
    expect(entry!.action).toBe('eligibility-rule.update')
    const detail = JSON.parse(entry!.detail!)
    expect(detail.from.allOf).toHaveLength(3)
    expect(detail.to.allOf).toEqual(['NNT-001'])
  })

  it('never puts an issued token in the audit log', async () => {
    await setup()
    const event = makeEvent({ method: 'POST', path: '/api/admin/service-tokens', body: { name: 'photos' } })
    signIn(event, { id: 'tm', roles: ['training:ADMIN'] })

    const created = await call(tokensHandler, event) as { token: string }
    const entries = await db.select().from(schema.auditLog).all()

    expect(entries.some(e => e.detail?.includes(created.token))).toBe(false)
  })

  it('is admin-only', async () => {
    await setup()
    const event = makeEvent({ method: 'POST', path: '/api/admin/service-tokens', body: { name: 'photos' } })
    signIn(event, { id: 'alice' })

    await expect(call(tokensHandler, event)).rejects.toMatchObject({ statusCode: 403 })
  })
})
