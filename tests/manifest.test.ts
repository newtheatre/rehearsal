/**
 * The declaration the auth service polls. Its eligibility rules come from the
 * table, so a rule the auth service cannot see is one nobody can gate on.
 */

import { describe, it, expect } from 'bun:test'
import { createHash } from 'node:crypto'
import manifestHandler from '../server/api/_hooks/auth/manifest.get'
import { db, schema } from './mocks/nuxthub-db'
import { makeEvent, runtimeConfig, type FakeEvent } from './setup'

const SERVICE_TOKEN = 'nnt_svc_test-token'
const HASH = createHash('sha256').update(SERVICE_TOKEN).digest('hex')

interface Manifest {
  contract: number
  namespace: string
  permissions: { key: string }[]
  roles: { role: string, permissions: readonly string[] }[]
  eligibilityRules: { key: string, name: string }[]
}

const call = (event: FakeEvent) => (manifestHandler as unknown as (e: FakeEvent) => Promise<Manifest>)(event)

function manifestEvent(bearer: string | null = HASH) {
  return makeEvent({
    method: 'GET',
    path: '/api/_hooks/auth/manifest',
    headers: bearer === null ? {} : { authorization: `Bearer ${bearer}` },
  })
}

describe('the app manifest', () => {
  it('needs the service-hash bearer, like every other hook', async () => {
    runtimeConfig.authServiceToken = SERVICE_TOKEN

    await expect(call(manifestEvent(null))).rejects.toMatchObject({ statusCode: 401 })
    await expect(call(manifestEvent('wrong'))).rejects.toMatchObject({ statusCode: 401 })
  })

  it('declares the training namespace, not the repo name', async () => {
    runtimeConfig.authServiceToken = SERVICE_TOKEN

    const manifest = await call(manifestEvent())

    expect(manifest.namespace).toBe('training')
    expect(manifest.roles.map(r => r.role)).toEqual(['ADMIN'])
  })

  it('only grants permissions it also declares', async () => {
    runtimeConfig.authServiceToken = SERVICE_TOKEN

    const manifest = await call(manifestEvent())
    const declared = new Set(manifest.permissions.map(p => p.key))

    for (const role of manifest.roles) {
      for (const key of role.permissions) {
        expect(declared, `${role.role} grants undeclared ${key}`).toContain(key)
      }
    }
  })

  it('reports eligibility rules from the table, so it cannot drift', async () => {
    runtimeConfig.authServiceToken = SERVICE_TOKEN
    await db.insert(schema.eligibilityRules).values([
      { key: 'duty-manager', name: 'Duty Manager' },
      { key: 'get-in-lead', name: 'Get-in Lead' },
    ])

    const manifest = await call(manifestEvent())

    expect(manifest.eligibilityRules).toEqual([
      { key: 'duty-manager', name: 'Duty Manager' },
      { key: 'get-in-lead', name: 'Get-in Lead' },
    ])
  })
})
