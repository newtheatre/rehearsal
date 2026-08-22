/** DELETE /api/module-requests/:id: withdraw your own request. */

import { db, schema } from '@nuxthub/db'
import { eq } from 'drizzle-orm'
import { useAbilities } from '../../../utils/abilities'

export default defineEventHandler(async (event) => {
  const abilities = await useAbilities(event)
  const id = getRouterParam(event, 'id')

  const request = id
    ? await db.select().from(schema.moduleRequests).where(eq(schema.moduleRequests.id, id)).get()
    : undefined
  if (!request) throw createError({ statusCode: 404, statusMessage: 'Request not found' })

  if (request.userId !== abilities.user.id) {
    throw createError({ statusCode: 403, statusMessage: 'That is somebody else\'s request' })
  }
  if (request.status !== 'OPEN') {
    throw createError({ statusCode: 409, statusMessage: 'That request is already closed' })
  }

  await db.update(schema.moduleRequests)
    .set({ status: 'WITHDRAWN', resolvedAt: new Date() })
    .where(eq(schema.moduleRequests.id, request.id))

  return { id: request.id, status: 'WITHDRAWN' }
})
