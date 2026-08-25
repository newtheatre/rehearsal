/** PUT /api/sessions/:id/schedule: amend a session that has not been taught. */

import { sessionScheduleUpdateSchema } from '../../../utils/validation'
import { requireTrainer } from '../../../utils/auth'
import { assertAwardable, loadModules } from '../../../utils/records'
import { loadSessionRow, updateSchedule } from '../../../utils/scheduling'
import { assertMaySteward } from '../../../utils/sessionAuth'
import { tellPromoted } from '../../../utils/sessionNotify'
import { writeAudit } from '../../../utils/audit'
import { today } from '../../../../shared/utils/dates'

export default defineEventHandler(async (event) => {
  const abilities = await requireTrainer(event)
  const id = getRouterParam(event, 'id')

  const session = id ? await loadSessionRow(id) : undefined
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Session not found' })

  assertMaySteward(session, abilities)

  // A delivered session's records were stamped from its date, so amending it
  // here would leave them describing a day it no longer claims (ADR-0002).
  if (session.status === 'DELIVERED' || session.status === 'CANCELLED') {
    throw createError({
      statusCode: 409,
      statusMessage: 'That session is finished: edit it through the delivery log instead',
    })
  }

  const input = await readValidatedBody(event, sessionScheduleUpdateSchema.parse)

  if (input.heldOn && input.heldOn < today()) {
    throw createError({ statusCode: 400, statusMessage: 'That date has passed' })
  }
  // The same gate as creation: rescheduling must not slip a module past it.
  if (input.moduleIds) assertAwardable(await loadModules(input.moduleIds), 'SESSION')

  // Lowering capacity below the number already signed up is allowed: it moves
  // the people at the back onto the waitlist rather than removing them.
  const { promoted } = await updateSchedule({ session, input })

  await writeAudit({
    actorUserId: abilities.user.id,
    action: 'session.reschedule',
    target: session.id,
    // Field names for the free text, ids for the catalogue: notes and
    // description are about people, and audit_log is never scrubbed.
    detail: { changed: Object.keys(input), moduleIds: input.moduleIds, promoted: promoted.length },
  })

  // Raising capacity gives somebody a place, and they were promised an email
  // the moment one came free.
  const told = await tellPromoted(session.id, promoted.map(row => row.userId))

  return { id: session.id, promoted: told }
})
