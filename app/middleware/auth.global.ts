/**
 * Every page needs a session: nothing here is public. Global, so a new page
 * is protected the moment it exists (docs/permissions.md §pages).
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
