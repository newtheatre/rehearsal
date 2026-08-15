/**
 * Global API guard — protection is opt-OUT. Every /api/** request needs a
 * session except the allowlist. Also upserts the local user mirror.
 */

const PUBLIC_API = [
  /^\/api\/_auth\//, // nuxt-auth-utils session read
  /^\/api\/_nuxt_icon\//, // @nuxt/ui icon bundle
  /^\/api\/_hooks\//, // GDPR hooks — carry their own service-token bearer auth
  /^\/api\/v1\//, // consumer read API — service-token auth (Phase 4)
  /^\/api\/health$/,
]

export default defineEventHandler(async (event) => {
  if (!event.path.startsWith('/api/')) return
  if (PUBLIC_API.some(pattern => pattern.test(event.path))) return

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
