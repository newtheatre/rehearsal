/**
 * Global API guard: protection is opt-OUT. Every /api/** request needs a
 * session except the allowlist. Also upserts the local user mirror.
 */

import { dbFailureLine } from '../utils/dbError'

const PUBLIC_API = [
  /^\/api\/_auth\//, // nuxt-auth-utils session read
  /^\/api\/_nuxt_icon\//, // @nuxt/ui icon bundle
  // These two carry their own credentials, enforced by the middleware beside
  // this one rather than by each route remembering (hooks.ts, consumer-api.ts).
  /^\/api\/_hooks\//,
  /^\/api\/v1\//,
  /^\/api\/health$/,
]

/** Methods that create or destroy nothing, so the user mirror is optional. */
const MIRROR_OPTIONAL_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export default defineEventHandler(async (event) => {
  // event.path carries the query string, which anchored patterns must not see.
  const path = event.path.split('?')[0]!
  if (!path.startsWith('/api/')) return
  if (PUBLIC_API.some(pattern => pattern.test(path))) return

  const { user } = await getUserSession(event)

  if (!user) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
      message: 'You must be signed in to use the training system',
    })
  }

  try {
    await ensureLocalUser(user)
  }
  catch (error) {
    // The mirror is derived, so a read proceeds without it; a write may need
    // the row to exist, so a write still refuses (ADR-0016).
    if (!MIRROR_OPTIONAL_METHODS.has(event.method)) throw error
    console.error(dbFailureLine(`mirror upsert on ${event.method} ${path}`, error))
  }

  event.context.user = user
})
