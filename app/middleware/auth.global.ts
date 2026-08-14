/**
 * Every page requires a session — nothing in this app is public
 * (docs/permissions.md §pages). Global so protection is opt-OUT: a new page
 * is protected the moment it exists, without anyone remembering to add
 * middleware.
 *
 * Login is hosted by the auth service; unauthenticated visitors bounce to it
 * with the way back preserved. In dev use /dev-login instead.
 */
export default defineNuxtRouteMiddleware((to) => {
  const { loggedIn } = useUserSession()

  if (loggedIn.value) return

  if (import.meta.dev) {
    return navigateTo('/dev-login', { external: true })
  }

  const config = useRuntimeConfig()
  const target = `${useRequestURL().origin}${to.fullPath}`
  return navigateTo(
    `${config.public.authBaseURL}/login?redirect=${encodeURIComponent(target)}`,
    { external: true },
  )
})
