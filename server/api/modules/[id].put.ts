/**
 * PUT /api/modules/:id — edit a catalogue entry (including status changes).
 */

import { db, schema } from '@nuxthub/db'
import { eq } from 'drizzle-orm'
import { assertExpiryConsistent, moduleIdSchema, moduleUpdateSchema } from '../../utils/validation'
import { requireDepartmentSteward } from '../../utils/auth'
import { useAbilities } from '../../utils/abilities'
import { presentModule } from '../../utils/modules'
import { writeAudit } from '../../utils/audit'
import { applyKindRules } from '../../utils/kindRules'
import {
  assertDepartmentExists,
  assertIdMatchesDepartment,
  assertNoPrerequisiteCycle,
  assertPrerequisitesExist,
  replacePrerequisites,
} from '../../utils/moduleWrites'

export default defineEventHandler(async (event) => {
  const parsedId = moduleIdSchema.safeParse(getRouterParam(event, 'id'))
  if (!parsedId.success) {
    throw createError({ statusCode: 404, statusMessage: 'Module not found' })
  }
  const id = parsedId.data

  const existing = await db.select().from(schema.modules)
    .where(eq(schema.modules.id, id)).get()
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Module not found' })
  }

  const input = await readValidatedBody(event, moduleUpdateSchema.parse)

  await requireDepartmentSteward(event, existing.department, 'module.manage')
  if (input.department && input.department !== existing.department) {
    assertIdMatchesDepartment(id, input.department)
    await assertDepartmentExists(input.department)
    await requireDepartmentSteward(event, input.department, 'module.manage')
  }

  if (input.prerequisites) {
    await assertPrerequisitesExist(id, input.prerequisites)
    await assertNoPrerequisiteCycle(id, input.prerequisites)
  }

  // Kind rules depend on the resulting kind, not the submitted one.
  const merged = applyKindRules({
    kind: input.kind ?? existing.kind,
    grantsSupervisor: input.grantsSupervisor ?? existing.grantsSupervisor,
    grantsTrainer: input.grantsTrainer ?? existing.grantsTrainer,
  })

  // Validate the row the update would leave behind: the body's own schema
  // only sees the fields it submitted (a lone expiryMonths passes it).
  const resultingMode = merged.expiryMode ?? input.expiryMode ?? existing.expiryMode
  const resultingMonths = merged.expiryMode
    ? merged.expiryMonths
    : input.expiryMonths !== undefined ? input.expiryMonths : existing.expiryMonths
  assertExpiryConsistent(resultingMode, resultingMonths)

  const { prerequisites, kind: _kind, ...submitted } = input
  const fields = {
    ...submitted,
    kind: merged.kind,
    signoffRequired: merged.signoffRequired,
    grantsSupervisor: merged.grantsSupervisor,
    grantsTrainer: merged.grantsTrainer,
    ...(merged.expiryMode ? { expiryMode: merged.expiryMode, expiryMonths: merged.expiryMonths } : {}),
    updatedAt: new Date(),
  }

  await db.update(schema.modules).set(fields).where(eq(schema.modules.id, id))

  if (prerequisites) {
    await replacePrerequisites(id, prerequisites)
  }

  // Record what actually changed — a diff reads far better in the audit log
  // than a full row, especially for the status transitions people query for.
  const changed = Object.fromEntries(
    Object.entries(fields)
      .filter(([key, value]) => key !== 'updatedAt' && existing[key as keyof typeof existing] !== value)
      .map(([key, value]) => [key, { from: existing[key as keyof typeof existing], to: value }]),
  )

  await writeAudit({
    actorUserId: event.context.user?.id,
    action: 'module.update',
    target: id,
    detail: { changed, ...(prerequisites ? { prerequisites } : {}) },
  })

  const abilities = await useAbilities(event)
  const updated = await db.select().from(schema.modules)
    .where(eq(schema.modules.id, id)).get()

  return presentModule(updated!, abilities)
})
