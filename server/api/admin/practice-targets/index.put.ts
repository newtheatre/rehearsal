/** PUT /api/admin/practice-targets: create or update one target. */

import { db, schema } from '@nuxthub/db'
import { practiceTargetSchema } from '../../../utils/validation'
import { requirePermission } from '../../../utils/auth'
import { loadModules } from '../../../utils/records'
import { loadTarget } from '../../../utils/practice'
import { writeAudit } from '../../../utils/audit'

export default defineEventHandler(async (event) => {
  const admin = await requirePermission(event, 'config.manage')
  const input = await readValidatedBody(event, practiceTargetSchema.parse)

  // Rejects unknown ids, so a typo cannot quietly make a target match nothing.
  await loadModules(input.moduleIds)

  const before = await loadTarget(input.key)

  await db.insert(schema.practiceTargets)
    .values({
      key: input.key,
      name: input.name,
      description: input.description ?? null,
      consumer: input.consumer ?? null,
      moduleIds: input.moduleIds,
      graceHours: input.graceHours ?? null,
      status: input.status,
      updatedBy: admin.id,
    })
    .onConflictDoUpdate({
      target: schema.practiceTargets.key,
      set: {
        name: input.name,
        description: input.description ?? null,
        consumer: input.consumer ?? null,
        moduleIds: input.moduleIds,
        graceHours: input.graceHours ?? null,
        status: input.status,
        updatedBy: admin.id,
        updatedAt: new Date(),
      },
    })

  await writeAudit({
    actorUserId: admin.id,
    action: before ? 'practice-target.update' : 'practice-target.create',
    target: input.key,
    detail: {
      before: before && { moduleIds: before.moduleIds, status: before.status },
      after: { moduleIds: input.moduleIds, status: input.status },
    },
  })

  return { key: input.key }
})
