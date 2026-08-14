/**
 * DELETE /api/admin/leads/:id — stand someone down as lead.
 */

import { db, schema } from '@nuxthub/db'
import { eq } from 'drizzle-orm'
import { requireAdmin } from '../../../utils/auth'
import { writeAudit } from '../../../utils/audit'

export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const id = getRouterParam(event, 'id')

  const lead = id
    ? await db.select().from(schema.departmentLeads)
        .where(eq(schema.departmentLeads.id, id)).get()
    : undefined

  if (!lead) {
    throw createError({ statusCode: 404, statusMessage: 'Not a current lead' })
  }

  await db.delete(schema.departmentLeads).where(eq(schema.departmentLeads.id, lead.id))

  await writeAudit({
    actorUserId: admin.id,
    action: 'lead.remove',
    target: lead.id,
    detail: { department: lead.department, userId: lead.userId },
  })

  return { id: lead.id, department: lead.department, removed: true }
})
