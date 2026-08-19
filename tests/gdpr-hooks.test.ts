/**
 * The hooks the auth service calls. Training history outlives the person:
 * erasure removes the identity, not the record of who was trained.
 */

import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import exportHandler from '../server/api/_hooks/auth/export.post'
import anonymiseHandler from '../server/api/_hooks/auth/anonymise.post'
import lastActivityHandler from '../server/api/_hooks/auth/last-activity.post'
import mergeHandler from '../server/api/_hooks/auth/merge.post'
import { db, schema } from './mocks/nuxthub-db'
import { eq } from 'drizzle-orm'
import { makeEvent, runtimeConfig, type FakeEvent } from './setup'
import { seedDepartments, seedLead, seedModule, seedRecord, seedUser } from './helpers/fixtures'

type Handler = (event: FakeEvent) => Promise<unknown>
const call = (handler: unknown, event: FakeEvent) => (handler as Handler)(event)

const SERVICE_TOKEN = 'nnt_svc_test-token'
const HASH = createHash('sha256').update(SERVICE_TOKEN).digest('hex')

function hookEvent(body: unknown, bearer: string | null = HASH) {
  return makeEvent({
    method: 'POST',
    path: '/api/_hooks/auth/x',
    headers: bearer === null ? {} : { authorization: `Bearer ${bearer}` },
    body,
  })
}

async function setup() {
  runtimeConfig.authServiceToken = SERVICE_TOKEN
  await seedDepartments()
  await seedUser('alice', 'Alice Anderson')
  await seedUser('winner', 'Alice A')
  await seedUser('trainer', 'A Trainer')
  await seedModule('NNT-001', { name: 'Induction' })
  await seedModule('TECH-111', { name: 'Rigging' })
}

async function seedSession(id: string, heldOn: string, trainer: string, attendees: string[]) {
  await db.insert(schema.sessions).values({
    id, heldOn, trainerUserId: trainer, createdBy: trainer, notes: 'Alice struggled with the ladder',
  })
  for (const userId of attendees) {
    await db.insert(schema.sessionAttendees).values({ sessionId: id, userId })
  }
}

describe('hook authentication', () => {
  it('refuses a request with no bearer', async () => {
    await setup()
    await expect(call(exportHandler, hookEvent({ userId: 'alice' }, null)))
      .rejects.toMatchObject({ statusCode: 401 })
  })

  it('refuses the plaintext token — the hash is what travels', async () => {
    await setup()
    await expect(call(exportHandler, hookEvent({ userId: 'alice' }, SERVICE_TOKEN)))
      .rejects.toMatchObject({ statusCode: 401 })
  })

  it('refuses when this app has no token configured', async () => {
    await setup()
    runtimeConfig.authServiceToken = ''
    await expect(call(exportHandler, hookEvent({ userId: 'alice' })))
      .rejects.toMatchObject({ statusCode: 401 })
  })
})

describe('export', () => {
  it('returns everything held, including revoked and superseded records', async () => {
    await setup()
    await seedRecord({ userId: 'alice', moduleId: 'NNT-001', awardedAt: '2025-01-01', expiresAt: null })
    await seedRecord({
      userId: 'alice', moduleId: 'NNT-001', awardedAt: '2026-01-01', expiresAt: null,
      revokedAt: new Date(), revokedBy: 'trainer', revokeReason: 'Wrong person',
    })
    await seedSession('s1', '2026-02-01', 'trainer', ['alice'])

    const result = await call(exportHandler, hookEvent({ userId: 'alice' })) as {
      mirrored: boolean
      account: { email: string }
      trainingRecords: unknown[]
      sessionsAttended: unknown[]
    }

    expect(result.mirrored).toBe(true)
    expect(result.account.email).toBe('alice@dev.newtheatre.org.uk')
    // A subject-access request asks what we hold, not what currently counts.
    expect(result.trainingRecords).toHaveLength(2)
    expect(result.sessionsAttended).toHaveLength(1)
  })

  it('says so when the person never used the training system', async () => {
    await setup()
    const result = await call(exportHandler, hookEvent({ userId: 'stranger' })) as { mirrored: boolean }
    expect(result.mirrored).toBe(false)
  })
})

describe('anonymise', () => {
  it('removes the identity and keeps the training history', async () => {
    await setup()
    await seedRecord({ userId: 'alice', moduleId: 'NNT-001', expiresAt: null })
    await seedRecord({ userId: 'alice', moduleId: 'TECH-111', expiresAt: null })

    await call(anonymiseHandler, hookEvent({ userId: 'alice' }))

    const user = await db.select().from(schema.users).where(eq(schema.users.id, 'alice')).get()
    expect(user!.email).toBe('deleted-alice@anonymised.invalid')
    expect(user!.name).toBe('Deleted user')

    // The whole point: who was trained to do what survives as anonymous rows.
    const records = await db.select().from(schema.records)
      .where(eq(schema.records.userId, 'alice')).all()
    expect(records).toHaveLength(2)
  })

  it('scrubs the free text written about and by them', async () => {
    await setup()
    await seedRecord({
      userId: 'alice', moduleId: 'NNT-001', expiresAt: null,
      revokedAt: new Date(), revokedBy: 'trainer', revokeReason: 'Alice was not actually present',
    })
    await seedSession('s1', '2026-02-01', 'alice', ['trainer'])

    await call(anonymiseHandler, hookEvent({ userId: 'alice' }))

    const record = await db.select().from(schema.records)
      .where(eq(schema.records.userId, 'alice')).get()
    expect(record!.revokeReason).toBeNull()
    expect(record!.revokedAt).not.toBeNull() // the fact of revocation stays

    const session = await db.select().from(schema.sessions).get()
    expect(session!.notes).toBeNull()
  })

  it('scrubs the sign-off note, which shares the external_ref column', async () => {
    await setup()
    await seedRecord({
      userId: 'alice', moduleId: 'NNT-001', expiresAt: null,
      source: 'SIGNOFF', grantedBy: 'trainer',
      externalRef: 'Held back twice, re-tested after a complaint',
    })

    await call(anonymiseHandler, hookEvent({ userId: 'alice' }))

    const record = await db.select().from(schema.records)
      .where(eq(schema.records.userId, 'alice')).get()
    expect(record!.externalRef).toBeNull()
    expect(record!.moduleId).toBe('NNT-001') // the training itself survives
  })

  it('stamps the erasure once, however many times it is retried', async () => {
    await setup()
    await call(anonymiseHandler, hookEvent({ userId: 'alice' }))
    const first = await db.select().from(schema.users).where(eq(schema.users.id, 'alice')).get()

    await call(anonymiseHandler, hookEvent({ userId: 'alice' }))
    const second = await db.select().from(schema.users).where(eq(schema.users.id, 'alice')).get()

    expect(first!.anonymisedAt).not.toBeNull()
    expect(second!.anonymisedAt!.getTime()).toBe(first!.anonymisedAt!.getTime())
  })

  it('clears the admin cache so an erased account stops receiving digests', async () => {
    await setup()
    await db.update(schema.users).set({ isTrainingAdmin: true })
      .where(eq(schema.users.id, 'alice'))

    await call(anonymiseHandler, hookEvent({ userId: 'alice' }))

    const user = await db.select().from(schema.users).where(eq(schema.users.id, 'alice')).get()
    expect(user!.isTrainingAdmin).toBe(false)
  })

  it('is idempotent', async () => {
    await setup()
    await call(anonymiseHandler, hookEvent({ userId: 'alice' }))
    const second = await call(anonymiseHandler, hookEvent({ userId: 'alice' })) as { ok: boolean }

    expect(second.ok).toBe(true)
    const user = await db.select().from(schema.users).where(eq(schema.users.id, 'alice')).get()
    expect(user!.name).toBe('Deleted user')
  })

  it('succeeds for someone who was never mirrored', async () => {
    await setup()
    const result = await call(anonymiseHandler, hookEvent({ userId: 'stranger' })) as { ok: boolean, mirrored: boolean }
    expect(result).toMatchObject({ ok: true, mirrored: false })
  })
})

describe('last-activity', () => {
  it('takes the most recent of records, attendance and delivery', async () => {
    await setup()
    await seedRecord({ userId: 'alice', moduleId: 'NNT-001', awardedAt: '2025-03-01', expiresAt: null })
    await seedSession('s1', '2026-05-04', 'trainer', ['alice'])

    const result = await call(lastActivityHandler, hookEvent({ userIds: ['alice'] })) as Record<string, number | null>

    expect(result.alice).toBe(Date.parse('2026-05-04T00:00:00Z'))
  })

  it('counts delivering a session as activity', async () => {
    await setup()
    await seedSession('s1', '2026-06-01', 'trainer', ['alice'])

    // A trainer who never attends anything is still active.
    const result = await call(lastActivityHandler, hookEvent({ userIds: ['trainer'] })) as Record<string, number | null>
    expect(result.trainer).toBe(Date.parse('2026-06-01T00:00:00Z'))
  })

  it('returns null for someone with no activity', async () => {
    await setup()
    const result = await call(lastActivityHandler, hookEvent({ userIds: ['alice'] })) as Record<string, number | null>
    expect(result.alice).toBeNull()
  })

  it('answers for every id asked about, including unknown ones', async () => {
    await setup()
    const result = await call(lastActivityHandler, hookEvent({ userIds: ['alice', 'stranger'] })) as Record<string, number | null>
    expect(Object.keys(result).sort()).toEqual(['alice', 'stranger'])
  })

  it('chunks past the D1 bound-parameter cap', async () => {
    await setup()
    // 250 ids would blow the 100-parameter limit in one statement.
    const ids = Array.from({ length: 250 }, (_, i) => `user-${i}`)
    const result = await call(lastActivityHandler, hookEvent({ userIds: ids })) as Record<string, number | null>

    expect(Object.keys(result)).toHaveLength(250)
  })
})

describe('merge', () => {
  it('reports counts without writing on a dry run', async () => {
    await setup()
    await seedRecord({ userId: 'alice', moduleId: 'NNT-001', expiresAt: null })

    const result = await call(mergeHandler, hookEvent({
      fromUserId: 'alice', toUserId: 'winner', dryRun: true,
    })) as { counts: Record<string, number> }

    expect(result.counts.records).toBe(1)
    expect(await db.select().from(schema.users).where(eq(schema.users.id, 'alice')).get()).toBeTruthy()
  })

  it('re-points records, attendance and delivery onto the winner', async () => {
    await setup()
    await seedRecord({ userId: 'alice', moduleId: 'NNT-001', expiresAt: null })
    await seedSession('s1', '2026-02-01', 'alice', ['alice'])

    await call(mergeHandler, hookEvent({ fromUserId: 'alice', toUserId: 'winner' }))

    expect(await db.select().from(schema.records).where(eq(schema.records.userId, 'winner')).all()).toHaveLength(1)
    expect(await db.select().from(schema.sessionAttendees).where(eq(schema.sessionAttendees.userId, 'winner')).all()).toHaveLength(1)
    expect(await db.select().from(schema.sessions).where(eq(schema.sessions.trainerUserId, 'winner')).all()).toHaveLength(1)
    expect(await db.select().from(schema.users).where(eq(schema.users.id, 'alice')).get()).toBeUndefined()
  })

  it('re-points the staff-attribution columns, not just the obvious one', async () => {
    await setup()
    await seedRecord({
      userId: 'trainer', moduleId: 'NNT-001', expiresAt: null,
      source: 'SIGNOFF', grantedBy: 'alice',
    })
    await seedRecord({
      userId: 'trainer', moduleId: 'TECH-111', expiresAt: null,
      revokedAt: new Date(), revokedBy: 'alice', revokeReason: 'Error',
    })
    await seedLead('TECH', 'alice')

    await call(mergeHandler, hookEvent({ fromUserId: 'alice', toUserId: 'winner' }))

    const granted = await db.select().from(schema.records)
      .where(eq(schema.records.grantedBy, 'winner')).all()
    const revoked = await db.select().from(schema.records)
      .where(eq(schema.records.revokedBy, 'winner')).all()
    const leads = await db.select().from(schema.departmentLeads)
      .where(eq(schema.departmentLeads.userId, 'winner')).all()

    expect(granted).toHaveLength(1)
    expect(revoked).toHaveLength(1)
    expect(leads).toHaveLength(1)
  })

  it('survives both accounts attending the same session', async () => {
    await setup()
    // The unique (session_id, user_id) index would reject a blind update.
    await seedSession('s1', '2026-02-01', 'trainer', ['alice', 'winner'])

    await call(mergeHandler, hookEvent({ fromUserId: 'alice', toUserId: 'winner' }))

    const attendance = await db.select().from(schema.sessionAttendees).all()
    expect(attendance).toHaveLength(1)
    expect(attendance[0]!.userId).toBe('winner')
  })

  it('survives both accounts leading the same department', async () => {
    await setup()
    await seedLead('TECH', 'alice')
    await seedLead('TECH', 'winner')

    await call(mergeHandler, hookEvent({ fromUserId: 'alice', toUserId: 'winner' }))

    const leads = await db.select().from(schema.departmentLeads).all()
    expect(leads).toHaveLength(1)
    expect(leads[0]!.userId).toBe('winner')
  })

  it('creates the winner a mirror row if it has none', async () => {
    await setup()
    await db.delete(schema.users).where(eq(schema.users.id, 'winner'))
    await seedRecord({ userId: 'alice', moduleId: 'NNT-001', expiresAt: null })

    await call(mergeHandler, hookEvent({ fromUserId: 'alice', toUserId: 'winner' }))

    expect(await db.select().from(schema.users).where(eq(schema.users.id, 'winner')).get()).toBeTruthy()
  })

  it('is idempotent', async () => {
    await setup()
    await seedRecord({ userId: 'alice', moduleId: 'NNT-001', expiresAt: null })

    await call(mergeHandler, hookEvent({ fromUserId: 'alice', toUserId: 'winner' }))
    const second = await call(mergeHandler, hookEvent({ fromUserId: 'alice', toUserId: 'winner' })) as { notMirrored: boolean }

    expect(second.notMirrored).toBe(true)
    expect(await db.select().from(schema.records).where(eq(schema.records.userId, 'winner')).all()).toHaveLength(1)
  })

  it('refuses to merge an account into itself', async () => {
    await setup()
    await expect(call(mergeHandler, hookEvent({ fromUserId: 'alice', toUserId: 'alice' })))
      .rejects.toMatchObject({ statusCode: 400 })
  })
})
