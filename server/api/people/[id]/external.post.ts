/**
 * POST /api/people/:id/external: record an externally-awarded qualification.
 */

import { db, schema } from '@nuxthub/db'
import { eq } from 'drizzle-orm'
import { assertExpiryPlausible, externalRecordSchema } from '../../../utils/validation'
import { useAbilities } from '../../../utils/abilities'
import { requirePermission } from '../../../utils/auth'
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

  // The admin fallback is staleness-checked: a revoked role must not still
  // be able to create records.
  if (!abilities.leadOf.includes(module.department)) {
    if (!abilities.isAdmin) {
      throw createError({
        statusCode: 403,
        statusMessage: `Recording ${module.id} is for the ${module.department} lead or an admin`,
      })
    }
    await requirePermission(event, 'signoff.any')
  }

  // Opt-in per module: recording training done elsewhere is only sanctioned
  // where the catalogue says what evidence counts.
  if (!module.allowsExternal) {
    throw createError({
      statusCode: 400,
      statusMessage: `${module.id} cannot be recorded from an external certificate. A lead can enable that on the module if it should be.`,
    })
  }

  // The same plausibility floor and ten-year cap the sign-off route applies:
  // a mistyped century is a typo, not a policy (ADR-0012).
  if (input.expiresAt) {
    assertExpiryPlausible(
      input.awardedAt,
      input.expiresAt,
      'The certificate expires on or before the date it was awarded',
    )
  }

  const academicYearEnd = await getConfig('academic_year_end')
  const [record] = buildRecordInserts({
    users: [person.id],
    modules: [module],
    awardedAt: input.awardedAt,
    source: 'EXTERNAL',
    grantedBy: abilities.user.id,
    externalRef: input.externalRef,
    override: input.expiresAt ? { expiresAt: input.expiresAt } : undefined,
    academicYearEnd,
  })

  await db.insert(schema.records).values(record!)

  await writeAudit({
    actorUserId: abilities.user.id,
    action: 'record.external',
    target: record!.id,
    // No externalRef: it is free text about a person, and audit_log is never
    // scrubbed by the erasure hook (docs/gdpr-retention.md).
    detail: {
      userId: person.id,
      moduleId: module.id,
      awardedAt: input.awardedAt,
      expiresAt: record!.expiresAt,
    },
  })

  setResponseStatus(event, 201)
  return { id: record!.id, moduleId: module.id, expiresAt: record!.expiresAt }
})
