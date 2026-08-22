/** POST /api/sessions/:id/cancel: call it off and tell everyone signed up. */

import { cancelSessionSchema } from '../../../utils/validation'
import { requireTrainer } from '../../../utils/auth'
import { cancelSession, loadSessionRow } from '../../../utils/scheduling'
import { assertMaySteward } from '../../../utils/sessionAuth'
import { addressableUsers, sendEach, sessionEmailSummary } from '../../../utils/sessionNotify'
import { renderSessionCancelled } from '../../../utils/email'
import { writeAudit } from '../../../utils/audit'

export default defineEventHandler(async (event) => {
  const abilities = await requireTrainer(event)
  const id = getRouterParam(event, 'id')

  const session = id ? await loadSessionRow(id) : undefined
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Session not found' })

  assertMaySteward(session, abilities)

  if (session.status === 'DELIVERED') {
    throw createError({
      statusCode: 409,
      statusMessage: 'That session has been delivered: revoke its records instead of cancelling it',
    })
  }
  if (session.status === 'CANCELLED') {
    throw createError({ statusCode: 409, statusMessage: 'That session is already cancelled' })
  }

  const { reason } = await readValidatedBody(event, cancelSessionSchema.parse)

  const summary = await sessionEmailSummary(session.id)
  const { notify } = await cancelSession({
    sessionId: session.id,
    reason,
    actorUserId: abilities.user.id,
  })

  await writeAudit({
    actorUserId: abilities.user.id,
    action: 'session.cancel',
    target: session.id,
    detail: { heldOn: session.heldOn, reason, toldPeople: notify.length },
  })

  // After the audit: the cancellation is a fact whether or not the email lands.
  const recipients = await addressableUsers(notify.map(row => row.userId))
  const { sent, failed } = summary
    ? await sendEach(recipients, recipient => renderSessionCancelled({
        name: recipient.name,
        session: summary,
        reason,
      }))
    : { sent: 0, failed: [] as string[] }

  return { id: session.id, status: 'CANCELLED', told: sent, couldNotTell: failed.length }
})
