/** GET /api/admin/notifications — what has actually been sent, newest first. */

import { db, schema } from '@nuxthub/db'
import { desc, eq } from 'drizzle-orm'
import { requirePermission } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'config.manage')

  const rows = await db.select({
    id: schema.notificationLog.id,
    type: schema.notificationLog.type,
    moduleId: schema.notificationLog.moduleId,
    sentAt: schema.notificationLog.sentAt,
    name: schema.users.name,
  })
    .from(schema.notificationLog)
    .leftJoin(schema.users, eq(schema.notificationLog.userId, schema.users.id))
    .orderBy(desc(schema.notificationLog.sentAt))
    .limit(200)
    .all()

  return { notifications: rows }
})
