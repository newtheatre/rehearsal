/** POST /api/module-requests/:id/decline: reply to a request with a reason. */

import { db, schema } from '@nuxthub/db'
import { eq } from 'drizzle-orm'
import { declineRequestSchema } from '../../../utils/validation'
import { requireDepartmentSteward } from '../../../utils/auth'
import { loadModules } from '../../../utils/records'
import { writeAudit } from '../../../utils/audit'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  const request = id
    ? await db.select().from(schema.moduleRequests).where(eq(schema.moduleRequests.id, id)).get()
    : undefined
  if (!request) throw createError({ statusCode: 404, statusMessage: 'Request not found' })

  const [module] = await loadModules([request.moduleId])
  const abilities = await requireDepartmentSteward(event, module!.department, 'module.manage')

  if (request.status !== 'OPEN') {
    throw createError({ statusCode: 409, statusMessage: 'That request is already closed' })
  }

  const { reason } = await readValidatedBody(event, declineRequestSchema.parse)

  await db.update(schema.moduleRequests).set({
    status: 'DECLINED',
    declineReason: reason,
    resolvedAt: new Date(),
    resolvedBy: abilities.user.id,
  }).where(eq(schema.moduleRequests.id, request.id))

  await writeAudit({
    actorUserId: abilities.user.id,
    action: 'request.decline',
    target: request.id,
    detail: { moduleId: request.moduleId, userId: request.userId, reason },
  })

  return { id: request.id, status: 'DECLINED' }
})
