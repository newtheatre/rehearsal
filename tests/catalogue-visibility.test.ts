/**
 * Draft visibility: the Phase 1 acceptance criterion, and the one mistake
 * that would put half-written safety content in front of members.
 */

import { describe, it, expect } from 'vitest'
import { listModules, getModuleDetail } from '../server/utils/modules'
import type { Abilities } from '../server/utils/abilities'
import { seedDepartments, seedModule } from './helpers/fixtures'

const user = { id: 'u', email: 'u@x', name: 'U', verified: true, guest: false, roles: [] }
const member: Abilities = { user, isAdmin: false, leadOf: [], isTrainer: false }
const techLead: Abilities = { user, isAdmin: false, leadOf: ['TECH'], isTrainer: false }
const admin: Abilities = { user, isAdmin: true, leadOf: [], isTrainer: true }

async function seedCatalogue() {
  await seedDepartments()
  await seedModule('TECH-111', { status: 'ACTIVE', notes: 'internal note' })
  await seedModule('TECH-112', { status: 'DRAFT' })
  await seedModule('TECH-113', { status: 'RETIRED' })
  await seedModule('STGE-101', { status: 'DRAFT' })
}

describe('listModules', () => {
  it('hides drafts from ordinary members', async () => {
    await seedCatalogue()
    const ids = (await listModules(member)).map(m => m.id)

    expect(ids).toContain('TECH-111')
    expect(ids).not.toContain('TECH-112')
    expect(ids).not.toContain('STGE-101')
  })

  it('keeps retired modules visible, a member may hold a record for one', async () => {
    await seedCatalogue()
    expect((await listModules(member)).map(m => m.id)).toContain('TECH-113')
  })

  it('shows every draft to a lead, not only their own department', async () => {
    // Leads steward one department but review the catalogue as a whole; the
    // scoping that matters is on writes, not reads.
    await seedCatalogue()
    const ids = (await listModules(techLead)).map(m => m.id)

    expect(ids).toContain('TECH-112')
    expect(ids).toContain('STGE-101')
  })

  it('shows drafts to admins', async () => {
    await seedCatalogue()
    expect((await listModules(admin)).map(m => m.id)).toContain('TECH-112')
  })

  it('does not let a member surface drafts by asking for them', async () => {
    await seedCatalogue()
    expect(await listModules(member, { status: 'DRAFT' })).toEqual([])
    expect((await listModules(member, { status: 'all' })).map(m => m.id)).not.toContain('TECH-112')
  })

  it('filters by department and search without leaking drafts', async () => {
    await seedCatalogue()
    const ids = (await listModules(member, { department: 'TECH' })).map(m => m.id)

    expect(ids).toEqual(['TECH-111', 'TECH-113'])
    expect((await listModules(member, { q: 'tech-112' })).map(m => m.id)).toEqual([])
  })

  it('strips admin-only notes from members', async () => {
    await seedCatalogue()
    const [module] = await listModules(member, { q: 'TECH-111' })
    expect(module!.notes).toBeNull()

    const [asLead] = await listModules(techLead, { q: 'TECH-111' })
    expect(asLead!.notes).toBe('internal note')
  })
})

describe('getModuleDetail', () => {
  it('returns null for a draft a member may not see', async () => {
    await seedCatalogue()
    // The handler turns this into a 404: whether an unpublished module exists
    // is not a member's to know.
    expect(await getModuleDetail('TECH-112', member)).toBeNull()
    expect(await getModuleDetail('TECH-112', techLead)).not.toBeNull()
  })

  it('resolves prerequisites and dependents', async () => {
    await seedDepartments()
    await seedModule('TECH-111')
    await seedModule('TECH-211')
    const { db, schema } = await import('./mocks/nuxthub-db')
    await db.insert(schema.modulePrerequisites).values({ moduleId: 'TECH-211', requiresModuleId: 'TECH-111' })

    const detail = await getModuleDetail('TECH-211', member)
    expect(detail!.prerequisites.map(p => p.id)).toEqual(['TECH-111'])

    const prerequisite = await getModuleDetail('TECH-111', member)
    expect(prerequisite!.requiredBy.map(p => p.id)).toEqual(['TECH-211'])
  })

  it('hides a draft prerequisite from members while keeping it for leads', async () => {
    await seedDepartments()
    await seedModule('TECH-211')
    await seedModule('TECH-112', { status: 'DRAFT' })
    const { db, schema } = await import('./mocks/nuxthub-db')
    await db.insert(schema.modulePrerequisites).values({ moduleId: 'TECH-211', requiresModuleId: 'TECH-112' })

    expect((await getModuleDetail('TECH-211', member))!.prerequisites).toEqual([])
    expect((await getModuleDetail('TECH-211', techLead))!.prerequisites.map(p => p.id)).toEqual(['TECH-112'])
  })
})
