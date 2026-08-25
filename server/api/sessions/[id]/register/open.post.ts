/** POST /api/sessions/:id/register/open: start taking the register. */

import { requireTrainer } from '../../../../utils/auth'
import { loadSessionRow, moduleIdsFor, openRegisterStatement, registerFor } from '../../../../utils/scheduling'
import { assertMaySteward } from '../../../../utils/sessionAuth'
import { openWindowStatements } from '../../../../utils/practice'
import { auditStatement } from '../../../../utils/audit'
import { runAtomic } from '../../../../utils/batch'
import { formatDate, today } from '../../../../../shared/utils/dates'

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

  // Opening a register hands everyone signed up a live practice window, so it
  // waits for the day itself, as does the marking that follows it.
  if (session.heldOn > today()) {
    throw createError({
      statusCode: 409,
      statusMessage: `That session is not until ${formatDate(session.heldOn)}. Take the register on the day.`,
    })
  }

  const register = await registerFor(session)

  // Idempotent: a lead who taps twice, or on two phones, gets one open
  // register and one set of practice windows.
  let opened: { targetKey: string, userIds: string[] }[] = []
  if (!session.registerOpenedAt) {
    const windows = await openWindowStatements({
      sessionId: session.id,
      moduleIds: await moduleIdsFor(session.id),
      userIds: register.filter(entry => entry.status === 'SIGNED_UP').map(entry => entry.userId),
      endsAt: session.endsAt,
      openedBy: abilities.user.id,
    })
    opened = windows.opened

    // One batch: the stamp is the retry guard, so it must not land without the
    // windows it is the guard for (ADR-0009).
    await runAtomic([
      openRegisterStatement(session.id),
      ...windows.statements,
      auditStatement({
        actorUserId: abilities.user.id,
        action: 'session.register.open',
        target: session.id,
        detail: { heldOn: session.heldOn, practiceOpened: opened.map(item => item.targetKey) },
      }),
    ])
  }

  return {
    id: session.id,
    register,
    // Named so the lead is told what was unlocked, or that nothing was.
    practiceOpened: opened.map(item => item.targetKey),
  }
})
