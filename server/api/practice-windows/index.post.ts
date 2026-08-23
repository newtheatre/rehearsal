/** POST /api/practice-windows: open one by hand, for ad-hoc coaching. */

import { grantPracticeSchema } from '../../utils/validation'
import { requireTrainer } from '../../utils/auth'
import { grantWindow, loadTarget } from '../../utils/practice'
import { ensureKnownUser } from '../../utils/practiceAuth'
import { writeAudit } from '../../utils/audit'

export default defineEventHandler(async (event) => {
  const abilities = await requireTrainer(event)
  const input = await readValidatedBody(event, grantPracticeSchema.parse)

  const target = await loadTarget(input.targetKey)
  if (!target || target.status !== 'ACTIVE') {
    throw createError({ statusCode: 404, statusMessage: 'No such practice target' })
  }

  await ensureKnownUser(input.userId)

  const { id, expiresAt } = await grantWindow({
    userId: input.userId,
    targetKey: target.key,
    hours: input.hours,
    reason: input.reason,
    openedBy: abilities.user.id,
  })

  await writeAudit({
    actorUserId: abilities.user.id,
    action: 'practice-window.grant',
    target: id,
    detail: { userId: input.userId, targetKey: target.key, hours: input.hours, reason: input.reason },
  })

  setResponseStatus(event, 201)
  return { id, expiresAt: expiresAt.toISOString() }
})
