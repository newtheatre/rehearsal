/**
 * Guards the session-logging screens: a currently-valid Trainer
 * certification, a department lead, or an admin (ADR-0004).
 *
 * Trainer standing is app data derived from records, not a session role, so
 * this asks the server. Rendering-level only — POST /api/sessions re-derives
 * the same check before writing anything.
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
