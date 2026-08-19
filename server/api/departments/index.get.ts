/**
 * GET /api/departments: departments with the number of modules this caller
 * can actually see, so the catalogue's counts never advertise hidden drafts.
 */

import { db, schema } from '@nuxthub/db'
import { useAbilities } from '../../utils/abilities'
import { listModules } from '../../utils/modules'

export default defineEventHandler(async (event) => {
  const abilities = await useAbilities(event)

  const [departments, modules] = await Promise.all([
    db.select().from(schema.departments).all(),
    listModules(abilities),
  ])

  const counts = new Map<string, number>()
  for (const module of modules) {
    counts.set(module.department, (counts.get(module.department) ?? 0) + 1)
  }

  return {
    departments: departments
      .map(department => ({
        ...department,
        moduleCount: counts.get(department.code) ?? 0,
        isLead: abilities.leadOf.includes(department.code),
      }))
      .sort((a, b) => a.sort - b.sort),
  }
})
