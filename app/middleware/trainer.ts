/**
 * Session-logging screens: a valid Trainer certification, a lead, or an admin
 * (ADR-0004). Rendering-level only; POST /api/sessions re-derives it.
 */
export default defineNuxtRouteMiddleware(async () => {
  const request = useRequestFetch()

  try {
    const me = await request('/api/me')
    if (me.isTrainer || me.leadOf.length > 0) return
  }
  catch {
    // An unreadable session is not a permit.
  }

  return navigateTo('/')
})
