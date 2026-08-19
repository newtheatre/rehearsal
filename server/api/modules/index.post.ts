/**
 * POST /api/modules — create a catalogue entry.
 */

import { db, schema } from '@nuxthub/db'
import { eq } from 'drizzle-orm'
import { moduleCreateSchema } from '../../utils/validation'
import { requireDepartmentSteward } from '../../utils/auth'
import { useAbilities } from '../../utils/abilities'
import { presentModule } from '../../utils/modules'
import { writeAudit } from '../../utils/audit'
import {
  applyKindRules,
  assertDepartmentExists,
  assertIdMatchesDepartment,
  assertNoPrerequisiteCycle,
  assertPrerequisitesExist,
  replacePrerequisites,
} from '../../utils/moduleWrites'

export default defineEventHandler(async (event) => {
  const input = await readValidatedBody(event, moduleCreateSchema.parse)

  assertIdMatchesDepartment(input.id, input.department)
  await assertDepartmentExists(input.department)
  await requireDepartmentSteward(event, input.department, 'module.manage')

  const existing = await db.select({ id: schema.modules.id })
    .from(schema.modules).where(eq(schema.modules.id, input.id)).get()
  if (existing) {
    throw createError({ statusCode: 409, statusMessage: `Module ${input.id} already exists` })
  }

  await assertPrerequisitesExist(input.id, input.prerequisites)
  await assertNoPrerequisiteCycle(input.id, input.prerequisites)

  const { prerequisites, ...fields } = applyKindRules(input)

  await db.insert(schema.modules).values(fields)
  await replacePrerequisites(input.id, prerequisites)

  await writeAudit({
    actorUserId: event.context.user?.id,
    action: 'module.create',
    target: input.id,
    detail: { ...fields, prerequisites },
  })

  const abilities = await useAbilities(event)
  const created = await db.select().from(schema.modules)
    .where(eq(schema.modules.id, input.id)).get()

  setResponseStatus(event, 201)
  return presentModule(created!, abilities)
})
