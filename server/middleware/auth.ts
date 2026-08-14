/**
 * Global API guard — protection is opt-OUT, not opt-in
 * (stage-door docs/integrating-an-app.md §3, docs/permissions.md §pages).
 *
 * Every /api/** request needs a valid estate session except the explicit
 * public allowlist. Nothing in this app is public: unauthenticated visitors
 * get a login redirect, never data. Also upserts the local user mirror,
 * which every FK in the schema depends on.
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
