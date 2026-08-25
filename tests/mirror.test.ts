/**
 * The local user mirror and the fail-closed API middleware: the two things
 * every other server path assumes are working.
 */

import { describe, it, expect } from 'bun:test'
import authMiddleware from '../server/middleware/auth'
import lookupHandler from '../server/api/attendees/lookup.post'
import { ensureLocalUser, resetMirrorDebounce } from '../server/utils/ensureLocalUser'
import { db, schema } from './mocks/nuxthub-db'
import { eq } from 'drizzle-orm'
import { makeEvent, signIn, runtimeConfig, type FakeEvent } from './setup'
import { seedDepartments, seedModule, seedRecord, seedUser } from './helpers/fixtures'

type Handler = (event: FakeEvent) => Promise<unknown>
const call = (handler: unknown, event: FakeEvent) => (handler as Handler)(event)

const sessionUser = {
  id: 'auth-canonical-id',
  email: 'member@newtheatre.org.uk',
  name: 'A Member',
  verified: true,
  guest: false,
  roles: [],
}

async function seedTrainer() {
  runtimeConfig.authServiceToken = 'nnt_svc_test-token'
  await seedDepartments()
  await seedModule('LEAD-CERT', {
    department: 'LEAD',
    kind: 'CERTIFICATION',
    signoffRequired: true,
    grantsTrainer: true,
  })
  await seedUser('trainer', 'A Trainer')
  await seedRecord({ userId: 'trainer', moduleId: 'LEAD-CERT', expiresAt: null })
}

/** What the auth service's shadow endpoint answers with. */
function shadowAnswers(response: { id: string, email: string, name: string }) {
  ;(globalThis as Record<string, unknown>).$fetch = async () => response
}

async function lookup(email: string) {
  const event = makeEvent({ method: 'POST', path: '/api/attendees/lookup', body: { email } })
  signIn(event, { id: 'trainer' })
  return call(lookupHandler, event) as Promise<{ id: string, created: boolean }>
}

describe('ensureLocalUser', () => {
  it('creates the mirror row on first sight', async () => {
    await ensureLocalUser(sessionUser)

    const row = await db.select().from(schema.users).where(eq(schema.users.id, sessionUser.id)).get()
    expect(row).toMatchObject({ id: sessionUser.id, email: sessionUser.email, name: sessionUser.name })
  })

  it('is idempotent and updates a changed name', async () => {
    await ensureLocalUser(sessionUser)
    resetMirrorDebounce() // the debounce would otherwise skip the second write
    await ensureLocalUser({ ...sessionUser, name: 'A Renamed Member' })

    const rows = await db.select().from(schema.users).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.name).toBe('A Renamed Member')
  })

  it('debounces repeat upserts within the window', async () => {
    await ensureLocalUser(sessionUser)
    await ensureLocalUser({ ...sessionUser, name: 'Ignored' })

    const row = await db.select().from(schema.users).where(eq(schema.users.id, sessionUser.id)).get()
    expect(row!.name).toBe('A Member')
  })

  it('keeps the id the auth service issued, never minting one', async () => {
    await ensureLocalUser(sessionUser)
    const row = await db.select().from(schema.users).get()
    expect(row!.id).toBe('auth-canonical-id')
  })
})

describe('an erased person', () => {
  it('is not written back over by a still-valid session', async () => {
    await ensureLocalUser(sessionUser)

    // What the erasure hook leaves behind.
    await db.update(schema.users).set({
      email: `deleted-${sessionUser.id}@anonymised.invalid`,
      name: 'Deleted user',
      anonymisedAt: new Date(),
    }).where(eq(schema.users.id, sessionUser.id))

    // The sealed cookie outlives the erasure, so this runs on any request.
    resetMirrorDebounce()
    await ensureLocalUser(sessionUser)

    const row = await db.select().from(schema.users)
      .where(eq(schema.users.id, sessionUser.id)).get()
    expect(row!.name).toBe('Deleted user')
    expect(row!.email).toBe(`deleted-${sessionUser.id}@anonymised.invalid`)
  })

  it('cannot be added to a session by email through the shadow lookup', async () => {
    await seedTrainer()
    await seedUser('alice', 'Alice Adams')
    await db.update(schema.users).set({
      email: 'deleted-alice@anonymised.invalid',
      name: 'Deleted user',
      anonymisedAt: new Date(),
    }).where(eq(schema.users.id, 'alice'))

    // Stage-door's erasure is retried, so its own row can still answer with the
    // real address while this app's mirror is already scrubbed.
    shadowAnswers({ id: 'alice', email: 'alice@example.com', name: 'Alice Adams' })

    await expect(lookup('alice@example.com')).rejects.toMatchObject({ statusCode: 409 })

    const row = await db.select().from(schema.users).where(eq(schema.users.id, 'alice')).get()
    expect(row!.name).toBe('Deleted user')
    expect(await db.select().from(schema.auditLog).all()).toHaveLength(0)
  })

  it('cannot be added through a merged-away id either', async () => {
    await seedTrainer()
    await seedUser('winner', 'Alice Adams')
    await seedUser('loser', 'Alice A')
    await db.update(schema.users).set({ mergedInto: 'winner' })
      .where(eq(schema.users.id, 'loser'))

    shadowAnswers({ id: 'loser', email: 'alice@example.com', name: 'Alice Adams' })
    await expect(lookup('alice@example.com')).rejects.toMatchObject({ statusCode: 409 })
  })

  it('still resolves somebody who has simply never trained here', async () => {
    await seedTrainer()
    shadowAnswers({ id: 'newcomer', email: 'new@example.com', name: 'A Newcomer' })

    expect(await lookup('new@example.com')).toMatchObject({ id: 'newcomer', created: true })
  })
})

describe('global API middleware', () => {
  it('rejects an unauthenticated API request', async () => {
    const event = makeEvent({ path: '/api/modules' })
    await expect(call(authMiddleware, event)).rejects.toMatchObject({ statusCode: 401 })
  })

  it('lets the health check through', async () => {
    const event = makeEvent({ path: '/api/health' })
    await expect(call(authMiddleware, event)).resolves.toBeUndefined()
  })

  it('lets the health check through when a probe adds a query string', async () => {
    const event = makeEvent({ path: '/api/health?probe=1' })
    await expect(call(authMiddleware, event)).resolves.toBeUndefined()
  })

  it('still guards a protected route carrying a query string', async () => {
    const event = makeEvent({ path: '/api/modules?status=ACTIVE' })
    await expect(call(authMiddleware, event)).rejects.toMatchObject({ statusCode: 401 })
  })

  it('leaves non-API paths alone (pages have their own guard)', async () => {
    const event = makeEvent({ path: '/modules' })
    await expect(call(authMiddleware, event)).resolves.toBeUndefined()
  })

  it('fails closed on a path nobody allowlisted', async () => {
    // The point of the allowlist: a new endpoint is protected the moment it
    // exists, without anyone remembering to protect it.
    const event = makeEvent({ path: '/api/some/brand/new/thing' })
    await expect(call(authMiddleware, event)).rejects.toMatchObject({ statusCode: 401 })
  })

  it('mirrors the user and puts them on the context when authenticated', async () => {
    const event = makeEvent({ path: '/api/modules' })
    signIn(event, { id: 'auth-canonical-id', email: 'member@newtheatre.org.uk', name: 'A Member' })

    await call(authMiddleware, event)

    expect((event.context.user as { id: string }).id).toBe('auth-canonical-id')
    expect(await db.select().from(schema.users).get()).toBeTruthy()
  })

  it('exempts the hook and consumer-API paths, which carry their own auth', async () => {
    for (const path of ['/api/_hooks/auth/export', '/api/v1/modules']) {
      await expect(call(authMiddleware, makeEvent({ path }))).resolves.toBeUndefined()
    }
  })
})
