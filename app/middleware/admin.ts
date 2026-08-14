/**
 * Admin-only pages: the estate session plus `training:ADMIN`.
 *
 * Roles ride in the sealed cookie, so a privileged surface needs a fresh
 * session (≤15 min) before honouring one; stale sessions bounce through the
 * auth service's refresh endpoint.
 *
 * Admin pages only. Department-lead surfaces are guarded server-side against
 * `department_leads`, which is app data rather than session state, so they
 * need no staleness dance (docs/permissions.md).
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

  if (!hasRole(user.value, 'training', 'ADMIN')) {
    return navigateTo('/')
  }
})
