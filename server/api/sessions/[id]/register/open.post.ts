/** POST /api/sessions/:id/register/open: start taking the register. */

import { requireTrainer } from '../../../../utils/auth'
import { loadSessionRow, moduleIdsFor, openRegister, registerFor } from '../../../../utils/scheduling'
import { assertMaySteward } from '../../../../utils/sessionAuth'
import { openWindowsForSession } from '../../../../utils/practice'
import { writeAudit } from '../../../../utils/audit'

export default defineEventHandler(async (event) => {
  const abilities = await requireTrainer(event)
  const id = getRouterParam(event, 'id')

  const session = id ? await loadSessionRow(id) : undefined
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Session not found' })

  assertMaySteward(session, abilities)

  if (session.status !== 'OPEN' && session.status !== 'FULL') {
    throw createError({
      statusCode: 409,
      statusMessage: session.status === 'DELIVERED'
        ? 'That register has already been marked'
        : 'Open sign-ups before taking the register',
    })
  }

  const register = await registerFor(session)

  // Idempotent: a lead who taps twice, or on two phones, gets one open
  // register and one set of practice windows.
  let opened: { targetKey: string, userIds: string[] }[] = []
  if (!session.registerOpenedAt) {
    await openRegister(session.id)

    opened = await openWindowsForSession({
      sessionId: session.id,
      moduleIds: await moduleIdsFor(session.id),
      userIds: register.filter(entry => entry.status === 'SIGNED_UP').map(entry => entry.userId),
      endsAt: session.endsAt,
      openedBy: abilities.user.id,
    })

    await writeAudit({
      actorUserId: abilities.user.id,
      action: 'session.register.open',
      target: session.id,
      detail: { heldOn: session.heldOn, practiceOpened: opened.map(item => item.targetKey) },
    })
  }

  return {
    id: session.id,
    register,
    // Named so the lead is told what was unlocked, or that nothing was.
    practiceOpened: opened.map(item => item.targetKey),
  }
})
