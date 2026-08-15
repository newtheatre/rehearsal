/**
 * Catalogue-stewardship screens: department leads or admins. Lead authority
 * is app data, so this asks the server. Rendering-level only.
 */
export default defineNuxtRouteMiddleware(async () => {
  const request = useRequestFetch()

  try {
    const me = await request('/api/me')
    if (me.isAdmin || me.leadOf.length > 0) return
  }
  catch {
    // Fall through to the redirect: an unreadable session is not a permit.
  }

  return navigateTo('/')
})
