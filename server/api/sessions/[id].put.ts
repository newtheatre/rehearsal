/**
 * PUT /api/sessions/:id: correct a recently-logged session.
 */

import { db, schema } from '@nuxthub/db'
import { eq } from 'drizzle-orm'
import { sessionInputSchema } from '../../utils/validation'
import { requirePermission, requireTrainer } from '../../utils/auth'
import { getConfig, getConfigNumber } from '../../utils/siteConfig'
import { loadModules } from '../../utils/records'
import { checkSessionPrerequisites, applySessionEdit, withinEditWindow } from '../../utils/sessions'
import { writeAudit } from '../../utils/audit'

export default defineEventHandler(async (event) => {
  const abilities = await requireTrainer(event)
  const id = getRouterParam(event, 'id')

  const session = id
    ? await db.select().from(schema.sessions).where(eq(schema.sessions.id, id)).get()
    : undefined
  if (!session) {
    throw createError({ statusCode: 404, statusMessage: 'Session not found' })
  }

  // This route revokes and re-grants records, so it only makes sense once a
  // session has some. A scheduled one is amended through its own route.
  if (session.status !== 'DELIVERED') {
    throw createError({
      statusCode: 409,
      statusMessage: 'That session has not been delivered yet: amend the schedule instead',
    })
  }

  // Both admin fallbacks below are staleness-checked: editing someone else's
  // session, or one past its window, amends records for another person.
  const isOwnSession = session.trainerUserId === abilities.user.id || session.createdBy === abilities.user.id
  if (!isOwnSession) {
    if (!abilities.isAdmin) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Only the trainer who logged this session can edit it',
      })
    }
    await requirePermission(event, 'record.manage')
  }

  const editWindowDays = await getConfigNumber('session_edit_window_days')
  if (!withinEditWindow(session, editWindowDays)) {
    if (!abilities.isAdmin) {
      throw createError({
        statusCode: 409,
        statusMessage: `Sessions can only be edited for ${editWindowDays} days: correct the records individually instead`,
      })
    }
    await requirePermission(event, 'record.manage')
  }

  const input = await readValidatedBody(event, sessionInputSchema.parse)

  const [modules, warningWindowDays, academicYearEnd] = await Promise.all([
    loadModules(input.moduleIds),
    getConfigNumber('warning_window_days'),
    getConfig('academic_year_end'),
  ])

  const { blocking } = await checkSessionPrerequisites(modules, input.attendeeIds, { warningWindowDays })
  if (blocking.length > 0) {
    throw createError({
      statusCode: 422,
      statusMessage: 'Missing prerequisites for a safety-critical module',
      data: { blocking },
    })
  }

  const { revoked, created } = await applySessionEdit({
    sessionId: session.id,
    input,
    actorUserId: abilities.user.id,
    academicYearEnd,
  })

  await writeAudit({
    actorUserId: abilities.user.id,
    action: 'session.update',
    target: session.id,
    detail: {
      heldOn: input.heldOn,
      modules: input.moduleIds,
      attendees: input.attendeeIds.length,
      recordsRevoked: revoked,
      recordsCreated: created,
    },
  })

  return { id: session.id, recordsRevoked: revoked, recordsCreated: created }
})
