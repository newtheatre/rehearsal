/**
 * POST /api/people/:id/signoff: sign off a certification.
 */

import { db, schema } from '@nuxthub/db'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { assertExpiryPlausible, signoffSchema } from '../../../utils/validation'
import { useAbilities } from '../../../utils/abilities'
import { requirePermission } from '../../../utils/auth'
import { getConfig, getConfigNumber } from '../../../utils/siteConfig'
import { buildRecordInserts } from '../../../utils/records'
import { computeExpiresAt } from '../../../utils/expiry'
import { checkPrerequisites, describeGaps } from '../../../utils/prerequisites'
import { writeAudit } from '../../../utils/audit'

export default defineEventHandler(async (event) => {
  const abilities = await useAbilities(event)
  const userId = getRouterParam(event, 'id')
  const input = await readValidatedBody(event, signoffSchema.parse)

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

  if (!module.signoffRequired) {
    throw createError({
      statusCode: 400,
      statusMessage: `${module.id} is not a certification: record it by logging a session`,
    })
  }

  // Per-department authority (ADR-0005); the admin fallback is
  // staleness-checked so a revoked role cannot still sign off.
  if (!abilities.leadOf.includes(module.department)) {
    if (!abilities.isAdmin) {
      throw createError({
        statusCode: 403,
        statusMessage: `Signing off ${module.id} is for the ${module.department} lead or an admin`,
      })
    }
    await requirePermission(event, 'signoff.any')
  }

  const warningWindowDays = await getConfigNumber('warning_window_days')
  const { met, missing } = await checkPrerequisites(person.id, module.id, { warningWindowDays })

  if (!met) {
    throw createError({
      statusCode: 422,
      statusMessage: `${person.name} does not currently hold: ${describeGaps(missing)}`,
      data: { missing },
    })
  }

  // Never-expires is break-glass against lockout, so it needs authority over
  // records generally, staleness-checked, not just this department (ADR-0012).
  if (input.neverExpires) await requirePermission(event, 'record.manage')

  if (input.expiresAt) {
    if (module.expiryMode === 'NONE' || module.kind === 'BRIEF') {
      throw createError({
        statusCode: 400,
        statusMessage: `${module.id} does not expire. Change the module's policy if it should.`,
      })
    }
    assertExpiryPlausible(input.awardedAt, input.expiresAt, 'The expiry is on or before the date it was awarded')
  }

  const override = input.neverExpires
    ? { expiresAt: null }
    : input.expiresAt ? { expiresAt: input.expiresAt } : undefined

  const academicYearEnd = await getConfig('academic_year_end')
  const [record] = buildRecordInserts({
    users: [person.id],
    modules: [module],
    awardedAt: input.awardedAt,
    source: 'SIGNOFF',
    grantedBy: abilities.user.id,
    externalRef: input.note ?? null,
    override,
    academicYearEnd,
  })

  await db.insert(schema.records).values({ ...record!, id: record!.id ?? nanoid() })

  await writeAudit({
    actorUserId: abilities.user.id,
    action: 'record.signoff',
    target: record!.id,
    // No note: it is free text about a person, and audit_log is never scrubbed
    // by the erasure hook (docs/gdpr-retention.md).
    detail: {
      userId: person.id,
      moduleId: module.id,
      awardedAt: input.awardedAt,
      expiresAt: record!.expiresAt,
      expiryOverridden: record!.expiryOverridden,
      // The date policy would have stamped, so "how much extra?" is answerable.
      policyExpiresAt: computeExpiresAt(module, input.awardedAt, { academicYearEnd }),
    },
  })

  setResponseStatus(event, 201)
  return { id: record!.id, moduleId: module.id, expiresAt: record!.expiresAt }
})
