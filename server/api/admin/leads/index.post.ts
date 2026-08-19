/**
 * POST /api/admin/leads — make someone a lead of a department.
 */

import { db, schema } from '@nuxthub/db'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requirePermission } from '../../../utils/auth'
import { departmentCodeSchema } from '../../../utils/validation'
import { writeAudit } from '../../../utils/audit'

const bodySchema = z.object({
  department: departmentCodeSchema,
  userId: z.string().trim().min(1).max(64),
})

export default defineEventHandler(async (event) => {
  const admin = await requirePermission(event, 'config.manage')
  const { department, userId } = await readValidatedBody(event, bodySchema.parse)

  const [departmentRow, user] = await Promise.all([
    db.select({ code: schema.departments.code }).from(schema.departments)
      .where(eq(schema.departments.code, department)).get(),
    db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users)
      .where(eq(schema.users.id, userId)).get(),
  ])

  if (!departmentRow) {
    throw createError({ statusCode: 400, statusMessage: `Unknown department "${department}"` })
  }
  if (!user) {
    // Mirror rows appear on first sign-in, so this usually means the person
    // has never opened the app rather than that they don't exist.
    throw createError({
      statusCode: 400,
      statusMessage: 'That person has no record here yet — ask them to sign in once first',
    })
  }

  const existing = await db.select({ id: schema.departmentLeads.id })
    .from(schema.departmentLeads)
    .where(and(
      eq(schema.departmentLeads.department, department),
      eq(schema.departmentLeads.userId, userId),
    )).get()

  if (existing) {
    return { id: existing.id, department, userId, alreadyLead: true }
  }

  const [created] = await db.insert(schema.departmentLeads)
    .values({ department, userId, grantedBy: admin.id })
    .returning()

  await writeAudit({
    actorUserId: admin.id,
    action: 'lead.add',
    target: created!.id,
    detail: { department, userId, name: user.name },
  })

  setResponseStatus(event, 201)
  return { id: created!.id, department, userId, name: user.name }
})
