/** POST /api/sessions/:id/open: put a planned session in front of members. */

import { requireTrainer } from '../../../utils/auth'
import { loadSessionRow, moduleIdsFor, openSignups } from '../../../utils/scheduling'
import { assertMaySteward } from '../../../utils/sessionAuth'
import { resolveRequestsFor } from '../../../utils/moduleRequests'
import { writeAudit } from '../../../utils/audit'

export default defineEventHandler(async (event) => {
  const abilities = await requireTrainer(event)
  const id = getRouterParam(event, 'id')

  const session = id ? await loadSessionRow(id) : undefined
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Session not found' })

  assertMaySteward(session, abilities)

  if (session.status !== 'PLANNED') {
    throw createError({
      statusCode: 409,
      statusMessage: session.status === 'OPEN' || session.status === 'FULL'
        ? 'Sign-ups are already open'
        : 'Only a planned session can be opened for sign-ups',
    })
  }

  await openSignups(session.id)

  const answered = await resolveRequestsFor({
    moduleIds: await moduleIdsFor(session.id),
    sessionId: session.id,
    actorUserId: abilities.user.id,
  })

  await writeAudit({
    actorUserId: abilities.user.id,
    action: 'session.open',
    target: session.id,
    detail: { heldOn: session.heldOn, requestsAnswered: answered.length },
  })

  return { id: session.id, status: 'OPEN', requestsAnswered: answered.length }
})
