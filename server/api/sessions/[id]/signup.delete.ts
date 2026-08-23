/** DELETE /api/sessions/:id/signup: give up a place, and pass it on. */

import { useAbilities } from '../../../utils/abilities'
import { loadSessionRow, withdraw, withdrawBlockedReason, SignupError } from '../../../utils/scheduling'
import { addressableUsers, sendEach, sessionEmailSummary } from '../../../utils/sessionNotify'
import { renderWaitlistPromotion } from '../../../utils/email'

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

  const summary = await sessionEmailSummary(session.id)
  if (summary && promoted.length > 0) {
    const recipients = await addressableUsers(promoted.map(row => row.userId))
    await sendEach(recipients, recipient => renderWaitlistPromotion({
      name: recipient.name,
      session: summary,
    }))
  }

  return { withdrawn: true, promoted: promoted.length }
})
