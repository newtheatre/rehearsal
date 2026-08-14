/**
 * The ability layer: the three sources of authority and, in particular, that
 * trainer standing is derived from a record rather than stored anywhere
 * (ADR-0004).
 */

import { describe, it, expect } from 'vitest'
import { getAbilities, holdsTrainerCertification, leadDepartments, canSeeDrafts, canStewardDepartment } from '../server/utils/abilities'
import { computeExpiresAt } from '../server/utils/expiry'
import { today } from '../server/utils/validity'
import { seedDepartments, seedLead, seedModule, seedRecord, seedUser } from './helpers/fixtures'

const sessionUser = (id: string, roles: string[] = []) => ({
  id,
  email: `${id}@dev.newtheatre.org.uk`,
  name: id,
  verified: true,
  guest: false,
  roles,
})

async function seedTrainerCert() {
  await seedDepartments()
  await seedModule('LEAD-CERT', {
    department: 'LEAD',
    kind: 'CERTIFICATION',
    signoffRequired: true,
    grantsTrainer: true,
  })
}

describe('trainer standing', () => {
  it('is granted by a currently-valid grants_trainer record', async () => {
    await seedTrainerCert()
    await seedUser('alice')
    await seedRecord({ userId: 'alice', moduleId: 'LEAD-CERT', expiresAt: null })

    expect(await holdsTrainerCertification('alice')).toBe(true)
  })

  it('is not granted by an expired record', async () => {
    await seedTrainerCert()
    await seedUser('alice')
    await seedRecord({ userId: 'alice', moduleId: 'LEAD-CERT', expiresAt: '2020-09-30' })

    expect(await holdsTrainerCertification('alice')).toBe(false)
  })

  it('survives inside the warning window — the ability must not flicker off early', async () => {
    await seedTrainerCert()
    await seedUser('alice')
    // Expiring within the 60-day window still counts as held.
    const soon = computeExpiresAt({ expiryMode: 'ACADEMIC_YEAR' }, today())
    await seedRecord({ userId: 'alice', moduleId: 'LEAD-CERT', expiresAt: soon })

    expect(await holdsTrainerCertification('alice')).toBe(true)
  })

  it('is removed by revocation without deleting the record', async () => {
    await seedTrainerCert()
    await seedUser('alice')
    await seedUser('tm')
    await seedRecord({
      userId: 'alice',
      moduleId: 'LEAD-CERT',
      expiresAt: null,
      revokedAt: new Date(),
      revokedBy: 'tm',
      revokeReason: 'Granted in error',
    })

    expect(await holdsTrainerCertification('alice')).toBe(false)
  })

  it('is not granted by a record for a module that confers nothing', async () => {
    await seedTrainerCert()
    await seedModule('TECH-111')
    await seedUser('alice')
    await seedRecord({ userId: 'alice', moduleId: 'TECH-111', expiresAt: null })

    expect(await holdsTrainerCertification('alice')).toBe(false)
  })
})

describe('getAbilities', () => {
  it('reads training:ADMIN from the session, and nothing else from it', async () => {
    await seedTrainerCert()
    await seedUser('tm')

    const abilities = await getAbilities(sessionUser('tm', ['training:ADMIN']))
    expect(abilities.isAdmin).toBe(true)
    // Admins bypass the trainer gate without holding the certification.
    expect(abilities.isTrainer).toBe(true)
    expect(abilities.leadOf).toEqual([])
  })

  it('ignores roles from other apps', async () => {
    await seedTrainerCert()
    await seedUser('bob')

    const abilities = await getAbilities(sessionUser('bob', ['rooms:ADMIN', 'proscenium:ADMIN']))
    expect(abilities.isAdmin).toBe(false)
    expect(abilities.isTrainer).toBe(false)
  })

  it('reads department leadership from app data', async () => {
    await seedTrainerCert()
    await seedUser('ctd')
    await seedLead('TECH', 'ctd')

    const abilities = await getAbilities(sessionUser('ctd'))
    expect(abilities.leadOf).toEqual(['TECH'])
    expect(await leadDepartments('ctd')).toEqual(['TECH'])
  })
})

describe('ability predicates', () => {
  const base = { user: sessionUser('x'), isTrainer: false }

  it('lets admins and leads see drafts, and nobody else', () => {
    expect(canSeeDrafts({ ...base, isAdmin: true, leadOf: [] })).toBe(true)
    expect(canSeeDrafts({ ...base, isAdmin: false, leadOf: ['TECH'] })).toBe(true)
    expect(canSeeDrafts({ ...base, isAdmin: false, leadOf: [] })).toBe(false)
  })

  it('scopes stewardship to a lead’s own departments', () => {
    const lead = { ...base, isAdmin: false, leadOf: ['TECH'] }
    expect(canStewardDepartment(lead, 'TECH')).toBe(true)
    expect(canStewardDepartment(lead, 'STGE')).toBe(false)

    const admin = { ...base, isAdmin: true, leadOf: [] }
    expect(canStewardDepartment(admin, 'STGE')).toBe(true)
  })
})
