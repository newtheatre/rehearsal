/**
 * GET /api/admin/expiry-preview — what tonight's sweep would do.
 *
 * Sends nothing, logs nothing, changes nothing. This is the screen an
 * operator checks before flipping notifications to live, and the one they
 * come back to when a member asks why they got an email.
 */

import { z } from 'zod'
import { requireAdmin } from '../../utils/auth'
import { previewExpirySweep } from '../../utils/expirySweep'
import { getConfig } from '../../utils/siteConfig'
import { today } from '../../utils/validity'

const querySchema = z.object({
  // Lets an operator answer "what will happen on 1 October?" without waiting.
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const { asOf } = await getValidatedQuery(event, querySchema.parse)

  const [plan, mode] = await Promise.all([
    previewExpirySweep(asOf ?? today()),
    getConfig('notifications_mode'),
  ])

  return {
    asOf: asOf ?? today(),
    mode,
    counts: plan.counts,
    warnings: plan.warnings.map(w => ({
      name: w.name,
      type: w.type,
      modules: w.records.map(r => ({ id: r.moduleId, name: r.moduleName, expiresAt: r.expiresAt })),
    })),
    digests: plan.digests.map(d => ({
      name: d.name,
      departments: d.departments,
      expiring: d.expiring.length,
      expired: d.expired.length,
    })),
  }
})
