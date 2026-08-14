/**
 * DEV ONLY — clears the locally-sealed dev session. In production logout is a
 * redirect to the auth service and this route does not exist.
 */
export default defineEventHandler(async (event) => {
  if (!import.meta.dev) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }

  await clearUserSession(event)
  return sendRedirect(event, '/dev-login', 302)
})
