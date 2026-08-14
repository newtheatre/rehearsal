/**
 * POST /api/people/:id/signoff — sign off a certification.
 *
 * The prerequisite check here is a HARD gate, re-evaluated server-side
 * (CLAUDE.md invariant 5). The UI disabling a button is not the check: this
 * is the moment someone becomes allowed to supervise a get-in or run a
 * training session, and the only thing standing between "trained" and
 * "believed trained" is this handler.
 */

import { db, schema } from '@nuxthub/db'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { signoffSchema } from '../../../utils/validation'
import { useAbilities, canStewardDepartment } from '../../../utils/abilities'
import { getConfig, getConfigNumber } from '../../../utils/siteConfig'
import { buildRecordInserts } from '../../../utils/records'
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
      statusMessage: `${module.id} is not a certification — record it by logging a session`,
    })
  }

  if (module.status === 'RETIRED') {
    throw createError({ statusCode: 400, statusMessage: `${module.id} is retired` })
  }

  // Authority is per-department: the CTD signs off tech certifications, not
  // stage management's (ADR-0005).
  if (!canStewardDepartment(abilities, module.department)) {
    throw createError({
      statusCode: 403,
      statusMessage: `Signing off ${module.id} is for the ${module.department} lead or an admin`,
    })
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

  const academicYearEnd = await getConfig('academic_year_end')
  const [record] = buildRecordInserts({
    users: [person.id],
    modules: [module],
    awardedAt: input.awardedAt,
    source: 'SIGNOFF',
    grantedBy: abilities.user.id,
    externalRef: input.note ?? null,
    academicYearEnd,
  })

  await db.insert(schema.records).values({ ...record!, id: record!.id ?? nanoid() })

  await writeAudit({
    actorUserId: abilities.user.id,
    action: 'record.signoff',
    target: record!.id,
    detail: {
      userId: person.id,
      moduleId: module.id,
      awardedAt: input.awardedAt,
      expiresAt: record!.expiresAt,
      note: input.note ?? null,
    },
  })

  setResponseStatus(event, 201)
  return { id: record!.id, moduleId: module.id, expiresAt: record!.expiresAt }
})
