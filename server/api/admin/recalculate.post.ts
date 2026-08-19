/**
 * POST /api/admin/recalculate — preview or apply an expiry recalculation.
 */

import { z } from 'zod'
import { requirePermission } from '../../utils/auth'
import { getConfig } from '../../utils/siteConfig'
import { applyRecalculation, planRecalculation } from '../../utils/recalculate'
import { moduleIdSchema } from '../../utils/validation'

const bodySchema = z.object({
  moduleId: moduleIdSchema.optional(),
  /** Omit to preview. Provide the previewed count to apply. */
  confirmChangeCount: z.number().int().min(0).optional(),
})

export default defineEventHandler(async (event) => {
  const admin = await requirePermission(event, 'record.manage')
  const { moduleId, confirmChangeCount } = await readValidatedBody(event, bodySchema.parse)

  const academicYearEnd = await getConfig('academic_year_end')
  const plan = await planRecalculation({ moduleId, academicYearEnd })

  if (confirmChangeCount === undefined) {
    return { applied: false, ...plan }
  }

  if (confirmChangeCount !== plan.changes.length) {
    throw createError({
      statusCode: 409,
      statusMessage: `The preview showed ${confirmChangeCount} changes but there are now ${plan.changes.length} — review it again`,
    })
  }

  const applied = await applyRecalculation(plan.changes, {
    actorUserId: admin.id,
    action: 'record.recalculate',
    target: moduleId ?? 'ALL',
    detail: {
      applied: plan.changes.length,
      academicYearEnd,
      changes: plan.changes.map(c => ({
        recordId: c.recordId,
        userId: c.userId,
        moduleId: c.moduleId,
        from: c.from,
        to: c.to,
      })),
    },
  })

  return { applied: true, changed: applied, ...plan }
})
