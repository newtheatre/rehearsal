/**
 * Guards the catalogue-stewardship screens: department leads (for their own
 * departments) or admins (docs/permissions.md §pages).
 *
 * Lead authority is app data, not a session role, so unlike `admin.ts` this
 * has to ask the server — and unlike `admin.ts` it needs no staleness dance,
 * because nothing it checks rides in the cookie.
 *
 * Rendering-level only: every write re-checks stewardship server-side.
 */
export default defineNuxtRouteMiddleware(async () => {
  const request = useRequestFetch()

  try {
    const me = await request('/api/me')
    if (me.isAdmin || me.leadOf.length > 0) return
  } catch {
    // Fall through to the redirect: an unreadable session is not a permit.
  }

  return navigateTo('/')
})
