/** DELETE /api/sessions/:id/signup: give up a place, and pass it on. */

import { useAbilities } from '../../../utils/abilities'
import { loadSessionRow, withdraw, withdrawBlockedReason, SignupError } from '../../../utils/scheduling'
import { tellPromoted } from '../../../utils/sessionNotify'

export default defineEventHandler(async (event) => {
  const abilities = await useAbilities(event)
  const id = getRouterParam(event, 'id')

  const session = id ? await loadSessionRow(id) : undefined
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Session not found' })

  const blocked = withdrawBlockedReason(session)
  if (blocked) throw createError({ statusCode: 409, statusMessage: blocked })

  let promoted
  try {
    ({ promoted } = await withdraw({ session, userId: abilities.user.id }))
  }
  catch (error) {
    if (error instanceof SignupError) {
      throw createError({ statusCode: error.statusCode, statusMessage: error.message })
    }
    throw error
  }

  const told = await tellPromoted(session.id, promoted.map(row => row.userId))

  return { withdrawn: true, promoted: told }
})
