/**
 * PUT /api/sessions/:id — correct a recently-logged session.
 *
 * Editing re-derives the records: the old ones are revoked (never deleted —
 * ADR-0008) and a fresh set created, all in one batch. Outside the edit
 * window the answer is no; corrections then go through revoke + re-grant,
 * which is a deliberate, individually-reasoned act rather than a quiet
 * rewrite of what a session recorded.
 */

import { db, schema } from '@nuxthub/db'
import { eq } from 'drizzle-orm'
import { sessionInputSchema } from '../../utils/validation'
import { requireTrainer } from '../../utils/auth'
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

  const isOwnSession = session.trainerUserId === abilities.user.id || session.createdBy === abilities.user.id
  if (!abilities.isAdmin && !isOwnSession) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Only the trainer who logged this session can edit it',
    })
  }

  const editWindowDays = await getConfigNumber('session_edit_window_days')
  if (!abilities.isAdmin && !withinEditWindow(session, editWindowDays)) {
    throw createError({
      statusCode: 409,
      statusMessage: `Sessions can only be edited for ${editWindowDays} days — correct the records individually instead`,
    })
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
