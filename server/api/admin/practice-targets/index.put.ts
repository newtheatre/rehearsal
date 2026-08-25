/** PUT /api/admin/practice-targets: create or update one target. */

import { db, schema } from '@nuxthub/db'
import { practiceTargetSchema } from '../../../utils/validation'
import { requirePermission } from '../../../utils/auth'
import { loadModules } from '../../../utils/records'
import { loadTarget } from '../../../utils/practice'
import { auditStatement } from '../../../utils/audit'
import { runAtomic } from '../../../utils/batch'

export default defineEventHandler(async (event) => {
  const admin = await requirePermission(event, 'config.manage')
  const input = await readValidatedBody(event, practiceTargetSchema.parse)

  // Rejects unknown ids, so a typo cannot quietly make a target match nothing.
  await loadModules(input.moduleIds)

  const before = await loadTarget(input.key)

  // A consumer hardcodes the key, so creating on a taken one would replace the
  // live target wholesale. The page's own check races a stale target list.
  if (input.create && before) {
    throw createError({
      statusCode: 409,
      statusMessage: `A target called "${input.key}" already exists. Edit that one, or pick another key.`,
    })
  }

  // One payload for both halves: two copies is how an insert and its update
  // come to disagree about a column.
  const values = {
    name: input.name,
    description: input.description ?? null,
    consumer: input.consumer ?? null,
    moduleIds: input.moduleIds,
    graceHours: input.graceHours ?? null,
    status: input.status,
    updatedBy: admin.id,
  }

  // One batch: the before-and-after in the audit row is what makes an emptied
  // module list recoverable, so it must not be able to go missing (ADR-0009).
  await runAtomic([
    db.insert(schema.practiceTargets)
      .values({ key: input.key, ...values })
      .onConflictDoUpdate({
        target: schema.practiceTargets.key,
        set: { ...values, updatedAt: new Date() },
      }),

    auditStatement({
      actorUserId: admin.id,
      action: before ? 'practice-target.update' : 'practice-target.create',
      target: input.key,
      detail: {
        before: before && { moduleIds: before.moduleIds, status: before.status },
        after: { moduleIds: input.moduleIds, status: input.status },
      },
    }),
  ])

  return { key: input.key }
})
