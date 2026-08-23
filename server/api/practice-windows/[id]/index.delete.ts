/** DELETE /api/practice-windows/:id: shut a sandbox early. */

import { db, schema } from '@nuxthub/db'
import { eq } from 'drizzle-orm'
import { requireTrainer } from '../../../utils/auth'
import { closeWindow } from '../../../utils/practice'
import { writeAudit } from '../../../utils/audit'

export default defineEventHandler(async (event) => {
  const abilities = await requireTrainer(event)
  const id = getRouterParam(event, 'id')

  const window = id
    ? await db.select().from(schema.practiceWindows).where(eq(schema.practiceWindows.id, id)).get()
    : undefined
  if (!window) throw createError({ statusCode: 404, statusMessage: 'Practice window not found' })

  await closeWindow(window.id, abilities.user.id)

  await writeAudit({
    actorUserId: abilities.user.id,
    action: 'practice-window.close',
    target: window.id,
    detail: { userId: window.userId, targetKey: window.targetKey },
  })

  return { id: window.id, closed: true }
})
