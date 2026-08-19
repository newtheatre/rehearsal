/**
 * Admin pages: estate session plus `training:ADMIN`, which needs a fresh
 * session. Lead surfaces use steward.ts and need no staleness dance.
 */
export default defineNuxtRouteMiddleware((to) => {
  const { loggedIn, user, session } = useUserSession()
  const config = useRuntimeConfig()
  const target = `${useRequestURL().origin}${to.fullPath}`

  if (!loggedIn.value) {
    if (import.meta.dev) {
      return navigateTo('/dev-login?admin=1', { external: true })
    }
    return navigateTo(
      `${config.public.authBaseURL}/login?redirect=${encodeURIComponent(target)}`,
      { external: true },
    )
  }

  if (isStale(session.value)) {
    // In dev the auth service usually isn't running; /dev-login re-seals a
    // fresh session, which is the local equivalent of a refresh.
    if (import.meta.dev) {
      return navigateTo('/dev-login?admin=1', { external: true })
    }
    return navigateTo(
      `${config.public.authBaseURL}/api/session/refresh?redirect=${encodeURIComponent(target)}`,
      { external: true },
    )
  }

  if (!hasRole(user.value, APP_MANIFEST.namespace, 'ADMIN')) {
    return navigateTo('/')
  }
})
