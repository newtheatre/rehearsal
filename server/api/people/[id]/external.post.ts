/**
 * POST /api/people/:id/external — record an externally-awarded qualification.
 */

import { db, schema } from '@nuxthub/db'
import { eq } from 'drizzle-orm'
import { externalRecordSchema } from '../../../utils/validation'
import { useAbilities, canStewardDepartment } from '../../../utils/abilities'
import { getConfig } from '../../../utils/siteConfig'
import { buildRecordInserts } from '../../../utils/records'
import { writeAudit } from '../../../utils/audit'

export default defineEventHandler(async (event) => {
  const abilities = await useAbilities(event)
  const userId = getRouterParam(event, 'id')
  const input = await readValidatedBody(event, externalRecordSchema.parse)

  const person = userId
    ? await db.select().from(schema.users).where(eq(schema.users.id, userId)).get()
    : undefined
  if (!person) {
    throw createError({ statusCode: 404, statusMessage: 'Person not found' })
  }

  const module = await db.select().from(schema.modules)
    .where(eq(schema.modules.id, input.moduleId)).get()
  if (!module) {
    throw createError({ statusCode: 404, statusMessage: 'Module not found' })
  }

  if (!canStewardDepartment(abilities, module.department)) {
    throw createError({
      statusCode: 403,
      statusMessage: `Recording ${module.id} is for the ${module.department} lead or an admin`,
    })
  }

  if (input.expiresAt && input.expiresAt <= input.awardedAt) {
    throw createError({
      statusCode: 400,
      statusMessage: 'The certificate expires on or before the date it was awarded',
    })
  }

  const academicYearEnd = await getConfig('academic_year_end')
  const [record] = buildRecordInserts({
    users: [person.id],
    modules: [module],
    awardedAt: input.awardedAt,
    source: 'EXTERNAL',
    grantedBy: abilities.user.id,
    externalRef: input.externalRef,
    externalExpiresAt: input.expiresAt ?? null,
    academicYearEnd,
  })

  await db.insert(schema.records).values(record!)

  await writeAudit({
    actorUserId: abilities.user.id,
    action: 'record.external',
    target: record!.id,
    detail: {
      userId: person.id,
      moduleId: module.id,
      awardedAt: input.awardedAt,
      expiresAt: record!.expiresAt,
      externalRef: input.externalRef,
    },
  })

  setResponseStatus(event, 201)
  return { id: record!.id, moduleId: module.id, expiresAt: record!.expiresAt }
})
