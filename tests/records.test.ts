/**
 * The record engine: what counts as a person's current training, and how
 * expiry gets stamped onto it.
 */

import { describe, it, expect } from 'vitest'
import { db, schema } from './mocks/nuxthub-db'
import {
  buildRecordInserts,
  currentRecordsFor,
  currentRecordsForModules,
  holdersOf,
  loadModules,
} from '../server/utils/records'
import { seedDepartments, seedModule, seedRecord, seedUser } from './helpers/fixtures'

async function setup() {
  await seedDepartments()
  await seedUser('alice', 'Alice')
  await seedUser('bob', 'Bob')
  await seedModule('TECH-111', { name: 'Rigging' })
  await seedModule('NNT-001', { name: 'Induction', expiryMode: 'ACADEMIC_YEAR' })
  await seedModule('NNT-002', { name: 'Get-In Brief', kind: 'BRIEF' })
}

describe('buildRecordInserts', () => {
  it('fans out attendees × modules', async () => {
    await setup()
    const modules = await loadModules(['TECH-111', 'NNT-001'])

    const inserts = buildRecordInserts({
      users: ['alice', 'bob'],
      modules,
      awardedAt: '2026-10-12',
      source: 'SESSION',
      sessionId: 'sess-1',
    })

    expect(inserts).toHaveLength(4)
    expect(inserts.every(i => i.sessionId === 'sess-1')).toBe(true)
    expect(inserts.every(i => i.source === 'SESSION')).toBe(true)
    // Distinct ids, generated up front so a batch can reference them.
    expect(new Set(inserts.map(i => i.id)).size).toBe(4)
  })

  it('stamps each module’s own policy at award time', async () => {
    await setup()
    const modules = await loadModules(['TECH-111', 'NNT-001'])

    const inserts = buildRecordInserts({
      users: ['alice'],
      modules,
      awardedAt: '2026-10-12',
      source: 'SESSION',
    })

    expect(inserts.find(i => i.moduleId === 'TECH-111')!.expiresAt).toBeNull()
    expect(inserts.find(i => i.moduleId === 'NNT-001')!.expiresAt).toBe('2027-09-30')
  })

  it('never expires a brief', async () => {
    await setup()
    const modules = await loadModules(['NNT-002'])
    const [insert] = buildRecordInserts({
      users: ['alice'], modules, awardedAt: '2026-10-12', source: 'SESSION',
    })
    expect(insert!.expiresAt).toBeNull()
  })

  it('rejects an unknown module rather than inventing one', async () => {
    await setup()
    await expect(loadModules(['TECH-111', 'TECH-999'])).rejects.toMatchObject({ statusCode: 400 })
  })
})

describe('current record resolution', () => {
  it('takes the latest award and keeps the earlier one as history', async () => {
    await setup()
    await seedRecord({ userId: 'alice', moduleId: 'TECH-111', awardedAt: '2025-01-01' })
    await seedRecord({ userId: 'alice', moduleId: 'TECH-111', awardedAt: '2026-01-01' })

    const current = await currentRecordsFor('alice')
    expect(current).toHaveLength(1)
    expect(current[0]!.awardedAt).toBe('2026-01-01')

    // Both rows are still there: re-training doesn't erase the first session.
    const all = await db.select().from(schema.records).all()
    expect(all).toHaveLength(2)
  })

  it('ignores revoked records but leaves the superseded one current', async () => {
    await setup()
    await seedRecord({ userId: 'alice', moduleId: 'TECH-111', awardedAt: '2025-01-01' })
    await seedRecord({
      userId: 'alice',
      moduleId: 'TECH-111',
      awardedAt: '2026-01-01',
      revokedAt: new Date(),
      revokedBy: 'bob',
      revokeReason: 'Logged against the wrong person',
    })

    const current = await currentRecordsFor('alice')
    // Revoking the newer award falls back to the older one rather than
    // leaving the person with nothing.
    expect(current).toHaveLength(1)
    expect(current[0]!.awardedAt).toBe('2025-01-01')
  })

  it('does not leak one person’s records into another’s', async () => {
    await setup()
    await seedRecord({ userId: 'alice', moduleId: 'TECH-111' })
    await seedRecord({ userId: 'bob', moduleId: 'NNT-001' })

    expect((await currentRecordsFor('alice')).map(r => r.moduleId)).toEqual(['TECH-111'])
    expect((await currentRecordsFor('bob')).map(r => r.moduleId)).toEqual(['NNT-001'])
  })

  it('derives state, and reports none for a brief', async () => {
    await setup()
    await seedRecord({ userId: 'alice', moduleId: 'TECH-111', expiresAt: null })
    await seedRecord({ userId: 'alice', moduleId: 'NNT-001', expiresAt: '2020-09-30' })
    await seedRecord({ userId: 'alice', moduleId: 'NNT-002', expiresAt: null })

    const byId = new Map((await currentRecordsFor('alice')).map(r => [r.moduleId, r]))
    expect(byId.get('TECH-111')!.state).toBe('VALID')
    expect(byId.get('NNT-001')!.state).toBe('EXPIRED')
    expect(byId.get('NNT-002')!.state).toBeNull()
  })

  it('looks up a subset of modules for one person', async () => {
    await setup()
    await seedRecord({ userId: 'alice', moduleId: 'TECH-111' })
    await seedRecord({ userId: 'bob', moduleId: 'TECH-111' })

    const held = await currentRecordsForModules('alice', ['TECH-111', 'NNT-001'])
    expect(held.has('TECH-111')).toBe(true)
    expect(held.has('NNT-001')).toBe(false)
  })
})

describe('holdersOf', () => {
  it('lists everyone currently holding a module, with state', async () => {
    await setup()
    await seedRecord({ userId: 'alice', moduleId: 'TECH-111', expiresAt: null })
    await seedRecord({ userId: 'bob', moduleId: 'TECH-111', expiresAt: '2020-01-01' })

    const holders = await holdersOf('TECH-111')
    const byUser = new Map(holders.map(h => [h.userId, h]))

    // Expired holders are listed but distinguished: held-but-expired is
    // visible, never hidden.
    expect(byUser.get('alice')!.state).toBe('VALID')
    expect(byUser.get('bob')!.state).toBe('EXPIRED')
  })

  it('excludes revoked holders entirely', async () => {
    await setup()
    await seedRecord({
      userId: 'bob',
      moduleId: 'TECH-111',
      revokedAt: new Date(),
      revokedBy: 'alice',
      revokeReason: 'Error',
    })

    expect(await holdersOf('TECH-111')).toEqual([])
  })
})
