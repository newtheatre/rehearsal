/**
 * POST /api/sessions — log a delivered training session.
 *
 * This is the endpoint that awards training, so it is the strictest one in
 * the app: trainer standing is re-derived from records here (never trusted
 * from the session), prerequisite gaps on safety-critical modules refuse
 * outright, and everything lands in a single atomic batch.
 */

import { sessionInputSchema } from '../../utils/validation'
import { requireTrainer } from '../../utils/auth'
import { getConfig, getConfigNumber } from '../../utils/siteConfig'
import { loadModules } from '../../utils/records'
import { checkSessionPrerequisites, createSession } from '../../utils/sessions'
import { describeGaps } from '../../utils/prerequisites'
import { writeAudit } from '../../utils/audit'

export default defineEventHandler(async (event) => {
  const abilities = await requireTrainer(event)
  const input = await readValidatedBody(event, sessionInputSchema.parse)

  if (input.attendeeIds.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A session needs at least one attendee to record anything',
    })
  }

  const [modules, warningWindowDays, academicYearEnd] = await Promise.all([
    loadModules(input.moduleIds),
    getConfigNumber('warning_window_days'),
    getConfig('academic_year_end'),
  ])

  const { warnings, blocking } = await checkSessionPrerequisites(
    modules,
    input.attendeeIds,
    { warningWindowDays },
  )

  // Safety-critical modules block. Everything else warns, and the trainer
  // confirms past it — they know why they are teaching someone.
  if (blocking.length > 0) {
    throw createError({
      statusCode: 422,
      statusMessage: 'Missing prerequisites for a safety-critical module',
      data: { blocking, warnings },
    })
  }

  if (warnings.length > 0 && !input.acknowledgeWarnings) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Some attendees are missing prerequisites',
      data: { warnings, requiresAcknowledgement: true },
    })
  }

  const { sessionId, recordCount } = await createSession({
    input,
    trainerUserId: abilities.user.id,
    createdBy: abilities.user.id,
    academicYearEnd,
  })

  await writeAudit({
    actorUserId: abilities.user.id,
    action: 'session.create',
    target: sessionId,
    detail: {
      heldOn: input.heldOn,
      modules: input.moduleIds,
      attendees: input.attendeeIds.length,
      recordsCreated: recordCount,
      acknowledgedWarnings: warnings.map(w => ({
        userId: w.userId,
        moduleId: w.moduleId,
        missing: describeGaps(w.missing),
      })),
    },
  })

  setResponseStatus(event, 201)
  return { id: sessionId, recordCount, warnings }
})
