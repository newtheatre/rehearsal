/** POST /api/sessions/:id/attendees: add somebody who turned up unannounced. */

import { addAttendeeSchema } from '../../../utils/validation'
import { requireTrainer } from '../../../utils/auth'
import { addAttendee, loadSessionRow, registerFor, SignupError } from '../../../utils/scheduling'
import { assertMaySteward } from '../../../utils/sessionAuth'
import { writeAudit } from '../../../utils/audit'

export default defineEventHandler(async (event) => {
  const abilities = await requireTrainer(event)
  const id = getRouterParam(event, 'id')

  const session = id ? await loadSessionRow(id) : undefined
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Session not found' })

  assertMaySteward(session, abilities)

  if (session.status === 'DELIVERED' || session.status === 'CANCELLED') {
    throw createError({
      statusCode: 409,
      statusMessage: 'That session is finished',
    })
  }

  const { userId } = await readValidatedBody(event, addAttendeeSchema.parse)

  try {
    await addAttendee({ session, userId })
  }
  catch (error) {
    if (error instanceof SignupError) {
      throw createError({ statusCode: error.statusCode, statusMessage: error.message })
    }
    throw error
  }

  await writeAudit({
    actorUserId: abilities.user.id,
    action: 'session.attendee.add',
    target: session.id,
    detail: { userId },
  })

  return { id: session.id, register: await registerFor(session) }
})
