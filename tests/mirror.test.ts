/**
 * The local user mirror and the fail-closed API middleware: the two things
 * every other server path assumes are working.
 */

import { describe, it, expect } from 'bun:test'
import authMiddleware from '../server/middleware/auth'
import { ensureLocalUser, resetMirrorDebounce } from '../server/utils/ensureLocalUser'
import { db, schema } from './mocks/nuxthub-db'
import { eq } from 'drizzle-orm'
import { makeEvent, signIn, type FakeEvent } from './setup'

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
