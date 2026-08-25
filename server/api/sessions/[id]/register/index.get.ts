/** GET /api/sessions/:id/register: who to mark off, in sign-up order. */

import { requireTrainer } from '../../../../utils/auth'
import { loadSessionRow, moduleIdsFor, registerFor } from '../../../../utils/scheduling'
import { openTargetKeysForSession, targetsForModules } from '../../../../utils/practice'
import { assertMaySteward } from '../../../../utils/sessionAuth'

export default defineEventHandler(async (event) => {
  const abilities = await requireTrainer(event)
  const id = getRouterParam(event, 'id')

  const session = id ? await loadSessionRow(id) : undefined
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Session not found' })

  assertMaySteward(session, abilities)

  // Named here rather than only in the open response, so the lead still sees
  // what practice this session unlocks after a reload or on a second phone.
  const targets = await targetsForModules(await moduleIdsFor(session.id))

  return {
    id: session.id,
    heldOn: session.heldOn,
    status: session.status,
    capacity: session.capacity,
    registerOpened: session.registerOpenedAt !== null,
    marked: session.status === 'DELIVERED',
    practiceTargets: targets.map(target => target.key),
    // What is actually unlocked right now, which is what the page may claim:
    // a matching target is not a window.
    practiceOpen: await openTargetKeysForSession(session.id),
    register: await registerFor(session),
  }
})
