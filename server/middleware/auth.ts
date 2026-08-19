/**
 * Global API guard: protection is opt-OUT. Every /api/** request needs a
 * session except the allowlist. Also upserts the local user mirror.
 */

const PUBLIC_API = [
  /^\/api\/_auth\//, // nuxt-auth-utils session read
  /^\/api\/_nuxt_icon\//, // @nuxt/ui icon bundle
  // These two carry their own credentials, enforced by the middleware beside
  // this one rather than by each route remembering (hooks.ts, consumer-api.ts).
  /^\/api\/_hooks\//,
  /^\/api\/v1\//,
  /^\/api\/health$/,
]

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

  await ensureLocalUser(user)
  event.context.user = user
})
