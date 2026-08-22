/** POST /api/sessions/:id/signup: take a place, or join the waitlist. */

import { useAbilities } from '../../../utils/abilities'
import { getConfigNumber } from '../../../utils/siteConfig'
import { loadModules } from '../../../utils/records'
import { checkSessionPrerequisites } from '../../../utils/sessions'
import { loadSessionRow, moduleIdsFor, signUp, signupBlockedReason, SignupError } from '../../../utils/scheduling'
import { addressableUsers, sendEach, sessionEmailSummary } from '../../../utils/sessionNotify'
import { renderSignupConfirmation } from '../../../utils/email'

export default defineEventHandler(async (event) => {
  const abilities = await useAbilities(event)
  const id = getRouterParam(event, 'id')

  const session = id ? await loadSessionRow(id) : undefined
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Session not found' })

  const blocked = signupBlockedReason(session)
  if (blocked) throw createError({ statusCode: 409, statusMessage: blocked })

  // The same check the delivery log runs: safety-critical gaps block, the
  // rest warn and the member decides (docs/scheduling-design.md §5.2).
  const [modules, warningWindowDays] = await Promise.all([
    loadModules(await moduleIdsFor(session.id)),
    getConfigNumber('warning_window_days'),
  ])
  const { blocking, warnings } = await checkSessionPrerequisites(
    modules,
    [abilities.user.id],
    { warningWindowDays },
  )
  if (blocking.length > 0) {
    throw createError({
      statusCode: 422,
      statusMessage: 'You need another module first before this one',
      data: { blocking },
    })
  }

  let result
  try {
    result = await signUp({ session, userId: abilities.user.id, source: 'SELF' })
  }
  catch (error) {
    if (error instanceof SignupError) {
      throw createError({ statusCode: error.statusCode, statusMessage: error.message })
    }
    throw error
  }

  const summary = await sessionEmailSummary(session.id)
  if (summary) {
    const recipients = await addressableUsers([abilities.user.id])
    await sendEach(recipients, recipient => renderSignupConfirmation({
      name: recipient.name,
      session: summary,
      hasPlace: result.hasPlace,
      waitlistPosition: result.waitlistPosition,
    }))
  }

  setResponseStatus(event, 201)
  return { ...result, warnings }
})
