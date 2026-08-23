/** POST /api/sessions/schedule: put a session in the diary. Writes no records. */

import { sessionScheduleSchema } from '../../utils/validation'
import { requireTrainer } from '../../utils/auth'
import { assertAwardable, loadModules } from '../../utils/records'
import { scheduleSession } from '../../utils/scheduling'
import { resolveRequestsFor } from '../../utils/moduleRequests'
import { writeAudit } from '../../utils/audit'
import { today } from '../../../shared/utils/dates'

export default defineEventHandler(async (event) => {
  const abilities = await requireTrainer(event)
  const input = await readValidatedBody(event, sessionScheduleSchema.parse)

  if (input.heldOn < today()) {
    throw createError({
      statusCode: 400,
      statusMessage: 'That date has passed: log it as a delivered session instead',
    })
  }

  // Rejects unknown ids, then the same gate the register will apply, so a
  // session cannot be booked onto modules its delivery would refuse.
  assertAwardable(await loadModules(input.moduleIds), 'SESSION')

  const { sessionId } = await scheduleSession({
    input,
    trainerUserId: abilities.user.id,
    createdBy: abilities.user.id,
    openNow: input.openNow,
  })

  // Only when it is actually offered to members: a planned session nobody can
  // see has not answered anybody's request.
  const answered = input.openNow
    ? await resolveRequestsFor({
        moduleIds: input.moduleIds,
        sessionId,
        actorUserId: abilities.user.id,
      })
    : []

  await writeAudit({
    actorUserId: abilities.user.id,
    action: 'session.schedule',
    target: sessionId,
    detail: {
      heldOn: input.heldOn,
      modules: input.moduleIds,
      capacity: input.capacity ?? null,
      openedImmediately: input.openNow,
      requestsAnswered: answered.length,
    },
  })

  setResponseStatus(event, 201)
  return {
    id: sessionId,
    status: input.openNow ? 'OPEN' : 'PLANNED',
    requestsAnswered: answered.length,
  }
})
