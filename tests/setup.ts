/**
 * Test globals: the auto-imports Nuxt provides in production, backed by light
 * fakes. Handlers under test are the real files from server/api.
 */

import { beforeEach, vi } from 'bun:test'
import { resetDb } from './mocks/nuxthub-db'
import { hasRole, hasAnyRole, isStale, ROLE_STALENESS_MS } from '@newtheatre/auth-types'
import { APP_MANIFEST } from '../shared/utils/appManifest'
import { ensureLocalUser, resetMirrorDebounce } from '../server/utils/ensureLocalUser'
import { writeAudit } from '../server/utils/audit'

export interface FakeEvent {
  method: string
  path: string
  body?: unknown
  headers: Record<string, string>
  query?: Record<string, unknown>
  params?: Record<string, string>
  context: Record<string, unknown>
  statusCode?: number
  responseHeaders?: Record<string, string>
  redirectedTo?: { url: string, status: number }
}

export class HttpError extends Error {
  statusCode: number
  statusMessage: string
  // h3 carries `data` through to the client (that's how the client middleware
  // learns a session is merely stale): the fake must too.
  data?: unknown
  constructor(opts: { statusCode: number, statusMessage?: string, message?: string, data?: unknown }) {
    super(opts.statusMessage ?? opts.message ?? 'Error')
    this.statusCode = opts.statusCode
    this.statusMessage = opts.statusMessage ?? ''
    this.data = opts.data
  }
}

const g = globalThis as Record<string, unknown>

// ── H3 fakes ────────────────────────────────────────────────────────────────

g.defineEventHandler = (handler: unknown) => handler
g.defineTask = (task: unknown) => task
g.createError = (opts: { statusCode: number, statusMessage?: string, message?: string, data?: unknown }) => new HttpError(opts)
g.readValidatedBody = async (event: FakeEvent, parse: (body: unknown) => unknown) => parse(event.body)
g.getValidatedQuery = async (event: FakeEvent, parse: (query: unknown) => unknown) => parse(event.query ?? {})
g.getQuery = (event: FakeEvent) => event.query ?? {}
g.getRouterParam = (event: FakeEvent, name: string) => event.params?.[name]
g.getRequestHeader = (event: FakeEvent, name: string) => event.headers?.[name.toLowerCase()]
g.setResponseStatus = (event: FakeEvent, code: number) => {
  event.statusCode = code
}
g.setHeader = (event: FakeEvent, name: string, value: string) => {
  // Recorded, not discarded: Cache-Control is a contract with consumers.
  event.responseHeaders ??= {}
  event.responseHeaders[name] = value
}
g.sendRedirect = (event: FakeEvent, url: string, status = 302) => {
  event.redirectedTo = { url, status }
}
g.$fetch = vi.fn()

/** Runtime config fake, dev-shaped: no auth service token, no Resend key. */
export const runtimeConfig = {
  session: { name: 'nnt-session', password: '', maxAge: 0 },
  authServiceToken: '',
  resendApiKey: '',
  resendFromEmail: 'training@newtheatre.org.uk',
  public: { baseURL: 'http://localhost:3000', authBaseURL: 'https://auth.newtheatre.org.uk' },
}
g.useRuntimeConfig = () => runtimeConfig

// ── Session store fake (nuxt-auth-utils) ────────────────────────────────────

const sessions = new WeakMap<object, Record<string, unknown>>()

g.setUserSession = async (event: object, session: Record<string, unknown>) => {
  sessions.set(event, session)
  return session
}
g.getUserSession = async (event: object) => sessions.get(event) ?? {}
g.clearUserSession = async (event: object) => sessions.delete(event)
g.requireUserSession = async (event: object) => {
  const session = sessions.get(event)
  if (!session?.user) throw new HttpError({ statusCode: 401, statusMessage: 'Unauthorized' })
  return session
}

/** Seal a session for an event (test helper). */
export function signIn(event: FakeEvent, user: {
  id: string
  email?: string
  name?: string
  roles?: string[]
}, { refreshedAt = Date.now() }: { refreshedAt?: number } = {}) {
  sessions.set(event, {
    user: {
      id: user.id,
      email: user.email ?? `${user.id}@dev.newtheatre.org.uk`,
      name: user.name ?? user.id,
      verified: true,
      guest: false,
      roles: user.roles ?? [],
    },
    loggedInAt: refreshedAt,
    refreshedAt,
    epoch: 0,
  })
  event.context.user = sessions.get(event)!.user
}

/** Build a bare event. */
export function makeEvent(overrides: Partial<FakeEvent> = {}): FakeEvent {
  return {
    method: 'GET',
    path: '/',
    headers: {},
    context: {},
    ...overrides,
  }
}

// ── Shared auto-imports (shared/utils + server/utils) ───────────────────────

g.APP_MANIFEST = APP_MANIFEST
g.hasRole = hasRole
g.hasAnyRole = hasAnyRole
g.isStale = isStale
g.ROLE_STALENESS_MS = ROLE_STALENESS_MS
g.ensureLocalUser = ensureLocalUser
g.writeAudit = writeAudit

beforeEach(async () => {
  await resetDb()
  resetMirrorDebounce()
})
