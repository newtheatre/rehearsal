/**
 * The hooks the auth service calls. Training history outlives the person:
 * erasure removes the identity, not the record of who was trained.
 */

import { describe, it, expect } from 'bun:test'
import { createHash } from 'node:crypto'
import exportHandler from '../server/api/_hooks/auth/export.post'
import anonymiseHandler from '../server/api/_hooks/auth/anonymise.post'
import lastActivityHandler from '../server/api/_hooks/auth/last-activity.post'
import mergeHandler from '../server/api/_hooks/auth/merge.post'
import { db, schema } from './mocks/nuxthub-db'
import { eq } from 'drizzle-orm'
import { makeEvent, runtimeConfig, type FakeEvent } from './setup'
import { seedDepartments, seedLead, seedModule, seedRecord, seedUser } from './helpers/fixtures'
import { ensureLocalUser, resetMirrorDebounce } from '../server/utils/ensureLocalUser'

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
    id,
    heldOn,
    trainerUserId: trainer,
    createdBy: trainer,
    // Booked a week before it is taught, as every real session is: created
    // today against a date months back is a state nothing can produce.
    createdAt: new Date(Date.parse(`${heldOn}T00:00:00Z`) - 7 * 86_400_000),
    notes: 'Alice struggled with the ladder',
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

  it('refuses the plaintext token, the hash is what travels', async () => {
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

  it('keeps a no-show out of sessionsAttended but in the bundle', async () => {
    await setup()
    await seedSession('s1', '2026-02-01', 'trainer', ['alice'])
    await db.update(schema.sessionAttendees)
      .set({ status: 'ABSENT' })
      .where(eq(schema.sessionAttendees.userId, 'alice'))

    const result = await call(exportHandler, hookEvent({ userId: 'alice' })) as {
      sessionsAttended: unknown[]
      sessionSignups: { status: string }[]
    }

    // Being marked absent is a fact held about them, so it is disclosed; it
    // is just not attendance.
    expect(result.sessionsAttended).toHaveLength(0)
    expect(result.sessionSignups).toHaveLength(1)
    expect(result.sessionSignups[0]!.status).toBe('ABSENT')
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

describe('last activity', () => {
  it('does not report a future session as activity already had', async () => {
    await setup()
    const future = new Date()
    future.setDate(future.getDate() + 30)
    const heldOn = future.toISOString().slice(0, 10)

    await db.insert(schema.sessions).values({
      id: 's-future', heldOn, trainerUserId: 'trainer', createdBy: 'trainer', status: 'OPEN',
    })
    await db.insert(schema.sessionAttendees).values({
      sessionId: 's-future', userId: 'alice', status: 'SIGNED_UP', signedUpAt: new Date(),
    })

    const result = await call(lastActivityHandler,
      hookEvent({ userIds: ['alice'] })) as Record<string, number | null>

    // Signing up is activity; the session's date has not happened yet.
    expect(result.alice).not.toBeNull()
    expect(result.alice!).toBeLessThanOrEqual(Date.now())
  })

  it('reports the sign-up when a register was marked before the session date', async () => {
    await setup()
    const future = new Date()
    future.setDate(future.getDate() + 30)
    const signedUpAt = new Date(Date.now() - 86_400_000)

    // The state a register marked early leaves behind. The date is the guard,
    // not the status, or the answer is a timestamp nobody has reached.
    await db.insert(schema.sessions).values({
      id: 's-early',
      heldOn: future.toISOString().slice(0, 10),
      trainerUserId: 'trainer',
      createdBy: 'trainer',
      status: 'DELIVERED',
    })
    await db.insert(schema.sessionAttendees).values({
      sessionId: 's-early', userId: 'alice', status: 'ATTENDED', signedUpAt,
    })

    const result = await call(lastActivityHandler,
      hookEvent({ userIds: ['alice', 'trainer'] })) as Record<string, number | null>

    // Not null: dropping the row would age them faster than the truth.
    expect(result.alice).toBe(signedUpAt.getTime())
    expect(result.trainer).not.toBeNull()
    expect(result.trainer!).toBeLessThanOrEqual(Date.now())
  })

  it('is not stuck by a record whose awarded_at will not parse', async () => {
    await setup()
    await seedRecord({ userId: 'alice', moduleId: 'NNT-001', awardedAt: 'not-a-date', expiresAt: null })
    await seedRecord({ userId: 'alice', moduleId: 'TECH-111', awardedAt: '2026-01-05', expiresAt: null })

    const result = await call(lastActivityHandler,
      hookEvent({ userIds: ['alice'] })) as Record<string, number | null>

    expect(result.alice).toBe(Date.parse('2026-01-05T00:00:00Z'))
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

  it('re-points every column this app owns, and says so when it misses one', async () => {
    await setup()
    await seedSession('s1', '2026-02-01', 'alice', ['alice'])

    // One row for each column added alongside scheduling and practice.
    await db.insert(schema.moduleRequests).values({ userId: 'alice', moduleId: 'TECH-111' })
    await db.update(schema.sessionAttendees).set({ markedByUserId: 'alice' })
    await db.insert(schema.practiceTargets).values({
      key: 'bar-till', name: 'Bar till', moduleIds: ['TECH-111'], updatedBy: 'alice',
    })
    await db.insert(schema.practiceWindows).values({
      userId: 'alice', targetKey: 'bar-till', openedBy: 'alice', closedBy: 'alice',
      opensAt: new Date(), expiresAt: new Date(Date.now() + 3_600_000),
    })

    await call(mergeHandler, hookEvent({ fromUserId: 'alice', toUserId: 'winner' }))

    // The handler re-counts afterwards, so a passing merge is the proof: two
    // of these tables have no key a delete could have failed on.
    expect((await db.select().from(schema.moduleRequests).all())[0]!.userId).toBe('winner')
    expect((await db.select().from(schema.practiceWindows).all())[0]!.userId).toBe('winner')
    expect((await db.select().from(schema.practiceTargets).all())[0]!.updatedBy).toBe('winner')
    expect((await db.select().from(schema.sessionAttendees).all())[0]!.markedByUserId).toBe('winner')
  })

  it('drops a colliding open request rather than failing the merge', async () => {
    await setup()
    await db.insert(schema.moduleRequests).values([
      { userId: 'alice', moduleId: 'TECH-111' },
      { userId: 'winner', moduleId: 'TECH-111' },
    ])

    await call(mergeHandler, hookEvent({ fromUserId: 'alice', toUserId: 'winner' }))

    // The partial unique index allows one open request per person per module.
    const open = await db.select().from(schema.moduleRequests).all()
    expect(open).toHaveLength(1)
    expect(open[0]!.userId).toBe('winner')
  })

  it('re-points records, attendance and delivery onto the winner', async () => {
    await setup()
    await seedRecord({ userId: 'alice', moduleId: 'NNT-001', expiresAt: null })
    await seedSession('s1', '2026-02-01', 'alice', ['alice'])

    await call(mergeHandler, hookEvent({ fromUserId: 'alice', toUserId: 'winner' }))

    expect(await db.select().from(schema.records).where(eq(schema.records.userId, 'winner')).all()).toHaveLength(1)
    expect(await db.select().from(schema.sessionAttendees).where(eq(schema.sessionAttendees.userId, 'winner')).all()).toHaveLength(1)
    expect(await db.select().from(schema.sessions).where(eq(schema.sessions.trainerUserId, 'winner')).all()).toHaveLength(1)

    const tombstone = await db.select().from(schema.users).where(eq(schema.users.id, 'alice')).get()
    expect(tombstone!.mergedInto).toBe('winner')
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
    const second = await call(mergeHandler, hookEvent({ fromUserId: 'alice', toUserId: 'winner' })) as { alreadyMerged: boolean }

    expect(second.alreadyMerged).toBe(true)
    expect(await db.select().from(schema.records).where(eq(schema.records.userId, 'winner')).all()).toHaveLength(1)
    // Exactly one, because the second call recognises a finished merge.
    expect(await db.select().from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'user.merge')).all()).toHaveLength(1)
  })

  it('re-points the audit actor, so a lead\'s history is not left as "Deleted user"', async () => {
    await setup()
    await db.insert(schema.auditLog).values({
      actorUserId: 'alice', action: 'record.signoff', target: 'r1',
    })

    const result = await call(mergeHandler, hookEvent({
      fromUserId: 'alice', toUserId: 'winner', dryRun: true,
    })) as { counts: Record<string, number> }
    expect(result.counts.auditActions).toBe(1)

    await call(mergeHandler, hookEvent({ fromUserId: 'alice', toUserId: 'winner' }))

    const moved = await db.select().from(schema.auditLog)
      .where(eq(schema.auditLog.actorUserId, 'winner')).all()
    expect(moved.map(row => row.action)).toContain('record.signoff')
  })

  it('keeps the attendance that was marked, not the one the winner happens to hold', async () => {
    await setup()
    await seedSession('s1', '2026-02-01', 'trainer', [])
    const markedAt = new Date('2026-02-01T20:00:00Z')
    await db.insert(schema.sessionAttendees).values([
      { sessionId: 's1', userId: 'alice', status: 'ATTENDED', markedAt, markedByUserId: 'trainer' },
      { sessionId: 's1', userId: 'winner', status: 'CANCELLED' },
    ])

    await call(mergeHandler, hookEvent({ fromUserId: 'alice', toUserId: 'winner' }))

    const attendance = await db.select().from(schema.sessionAttendees).all()
    expect(attendance).toHaveLength(1)
    expect(attendance[0]!.userId).toBe('winner')
    expect(attendance[0]!.status).toBe('ATTENDED')
    expect(attendance[0]!.markedByUserId).toBe('trainer')
    expect(attendance[0]!.markedAt).toEqual(markedAt)
  })

  it('keeps the winner\'s attendance when it is the marked one', async () => {
    await setup()
    await seedSession('s1', '2026-02-01', 'trainer', [])
    await db.insert(schema.sessionAttendees).values([
      { sessionId: 's1', userId: 'alice', status: 'CANCELLED' },
      { sessionId: 's1', userId: 'winner', status: 'ATTENDED', markedAt: new Date(), markedByUserId: 'trainer' },
    ])

    await call(mergeHandler, hookEvent({ fromUserId: 'alice', toUserId: 'winner' }))

    const attendance = await db.select().from(schema.sessionAttendees).all()
    expect(attendance).toHaveLength(1)
    expect(attendance[0]!.status).toBe('ATTENDED')
  })

  it('keeps the earlier appointment when both accounts lead a department', async () => {
    await setup()
    await db.insert(schema.departmentLeads).values([
      { department: 'TECH', userId: 'alice', grantedBy: 'trainer', createdAt: new Date('2025-10-01') },
      { department: 'TECH', userId: 'winner', createdAt: new Date('2026-06-01') },
    ])

    await call(mergeHandler, hookEvent({ fromUserId: 'alice', toUserId: 'winner' }))

    const leads = await db.select().from(schema.departmentLeads).all()
    expect(leads).toHaveLength(1)
    expect(leads[0]!.userId).toBe('winner')
    expect(leads[0]!.createdAt).toEqual(new Date('2025-10-01'))
    expect(leads[0]!.grantedBy).toBe('trainer')
  })

  it('leaves nothing behind when the write fails, so the retry does the whole merge', async () => {
    await setup()
    await seedRecord({ userId: 'alice', moduleId: 'NNT-001', expiresAt: null })

    type Batching = { batch: (...args: unknown[]) => Promise<unknown> }
    const batching = db as unknown as Batching
    const realBatch = batching.batch.bind(batching)
    batching.batch = async () => {
      throw new Error('D1 hiccup')
    }

    try {
      await expect(call(mergeHandler, hookEvent({ fromUserId: 'alice', toUserId: 'winner' })))
        .rejects.toThrow()
    }
    finally {
      batching.batch = realBatch
    }

    // Nothing tombstoned, so the retry cannot mistake this for a done merge.
    expect((await db.select().from(schema.users).where(eq(schema.users.id, 'alice')).get())!.mergedInto).toBeNull()
    expect(await db.select().from(schema.auditLog).all()).toHaveLength(0)

    await call(mergeHandler, hookEvent({ fromUserId: 'alice', toUserId: 'winner' }))
    expect(await db.select().from(schema.records).where(eq(schema.records.userId, 'winner')).all()).toHaveLength(1)
    expect(await db.select().from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'user.merge')).all()).toHaveLength(1)
  })

  it('does not let a session sealed before the merge resurrect the losing id', async () => {
    await setup()
    await seedRecord({ userId: 'alice', moduleId: 'NNT-001', expiresAt: null })
    await call(mergeHandler, hookEvent({ fromUserId: 'alice', toUserId: 'winner' }))

    resetMirrorDebounce()
    await ensureLocalUser({ id: 'alice', email: 'alice@nottingham.ac.uk', name: 'Alice Anderson' })

    const tombstone = await db.select().from(schema.users).where(eq(schema.users.id, 'alice')).get()
    expect(tombstone!.mergedInto).toBe('winner')
    expect(tombstone!.name).toBe('Merged account')
    expect(tombstone!.email).not.toBe('alice@nottingham.ac.uk')
  })

  it('refuses to merge an account into itself', async () => {
    await setup()
    await expect(call(mergeHandler, hookEvent({ fromUserId: 'alice', toUserId: 'alice' })))
      .rejects.toMatchObject({ statusCode: 400 })
  })
})
