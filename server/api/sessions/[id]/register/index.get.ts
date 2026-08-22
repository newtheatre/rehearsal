/** GET /api/sessions/:id/register: who to mark off, in sign-up order. */

import { requireTrainer } from '../../../../utils/auth'
import { loadSessionRow, registerFor } from '../../../../utils/scheduling'
import { assertMaySteward } from '../../../../utils/sessionAuth'

export default defineEventHandler(async (event) => {
  const abilities = await requireTrainer(event)
  const id = getRouterParam(event, 'id')

  const session = id ? await loadSessionRow(id) : undefined
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Session not found' })

  assertMaySteward(session, abilities)

  return {
    id: session.id,
    heldOn: session.heldOn,
    status: session.status,
    capacity: session.capacity,
    registerOpened: session.registerOpenedAt !== null,
    marked: session.status === 'DELIVERED',
    register: await registerFor(session),
  }
})
