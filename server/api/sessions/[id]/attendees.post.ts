/** POST /api/sessions/:id/attendees: add somebody who turned up unannounced. */

import { addAttendeeSchema } from '../../../utils/validation'
import { requireTrainer } from '../../../utils/auth'
import { addAttendee, loadSessionRow, moduleIdsFor, registerFor, SignupError } from '../../../utils/scheduling'
import { openWindowsForSession } from '../../../utils/practice'
import { ensureKnownUser } from '../../../utils/practiceAuth'
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

  // A merged-away or never-seen id is a 404, not a foreign-key 500.
  await ensureKnownUser(userId)

  try {
    await addAttendee({ session, userId })
  }
  catch (error) {
    if (error instanceof SignupError) {
      throw createError({ statusCode: error.statusCode, statusMessage: error.message })
    }
    throw error
  }

  // A walk-in added after the register opened would otherwise be the one
  // person in the room whose practice never unlocked.
  if (session.registerOpenedAt) {
    await openWindowsForSession({
      sessionId: session.id,
      moduleIds: await moduleIdsFor(session.id),
      userIds: [userId],
      endsAt: session.endsAt,
      openedBy: abilities.user.id,
    })
  }

  await writeAudit({
    actorUserId: abilities.user.id,
    action: 'session.attendee.add',
    target: session.id,
    detail: { userId },
  })

  return { id: session.id, register: await registerFor(session) }
})
