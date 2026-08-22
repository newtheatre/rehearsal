/** POST /api/sessions/schedule: put a session in the diary. Writes no records. */

import { sessionScheduleSchema } from '../../utils/validation'
import { requireTrainer } from '../../utils/auth'
import { loadModules } from '../../utils/records'
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

  // Rejects unknown ids, and refuses a retired module or one that needs a
  // sign-off rather than a session.
  const modules = await loadModules(input.moduleIds)
  const certifications = modules.filter(module => module.signoffRequired)
  if (certifications.length > 0) {
    throw createError({
      statusCode: 400,
      statusMessage: `${certifications.map(m => m.id).join(', ')} must be signed off, not taught in a session`,
    })
  }
  const retired = modules.filter(module => module.status === 'RETIRED')
  if (retired.length > 0) {
    throw createError({
      statusCode: 400,
      statusMessage: `Retired, so no longer teachable: ${retired.map(m => m.id).join(', ')}`,
    })
  }

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
