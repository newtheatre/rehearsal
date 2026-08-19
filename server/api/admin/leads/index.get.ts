/**
 * GET /api/admin/leads: who leads what.
 */

import { db, schema } from '@nuxthub/db'
import { eq } from 'drizzle-orm'
import { requirePermission } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'config.manage')

  const [departments, leads] = await Promise.all([
    db.select().from(schema.departments).all(),
    db.select({
      id: schema.departmentLeads.id,
      department: schema.departmentLeads.department,
      userId: schema.departmentLeads.userId,
      name: schema.users.name,
      createdAt: schema.departmentLeads.createdAt,
    })
      .from(schema.departmentLeads)
      .innerJoin(schema.users, eq(schema.departmentLeads.userId, schema.users.id))
      .all(),
  ])

  return {
    departments: departments
      .sort((a, b) => a.sort - b.sort)
      .map(department => ({
        code: department.code,
        name: department.name,
        leads: leads
          .filter(lead => lead.department === department.code)
          .sort((a, b) => a.name.localeCompare(b.name)),
      })),
  }
})
