/**
 * GET /api/people/:id — one person's training.
 */

import { db, schema } from '@nuxthub/db'
import { and, desc, eq, isNotNull } from 'drizzle-orm'
import { useAbilities, canSeeDrafts } from '../../utils/abilities'
import { getConfigNumber } from '../../utils/siteConfig'
import { currentRecordsFor } from '../../utils/records'
import { lapsedConstituents } from '../../utils/prerequisites'

export default defineEventHandler(async (event) => {
  const abilities = await useAbilities(event)
  const id = getRouterParam(event, 'id')

  const person = id
    ? await db.select({ id: schema.users.id, name: schema.users.name })
        .from(schema.users).where(eq(schema.users.id, id)).get()
    : undefined

  if (!person) {
    throw createError({ statusCode: 404, statusMessage: 'Person not found' })
  }

  const warningWindowDays = await getConfigNumber('warning_window_days')
  const records = await currentRecordsFor(person.id, { warningWindowDays })

  // A certification stays valid even if the modules behind it have lapsed —
  // but the page says so, which is the whole v1 stance (roadmap R2).
  const lapsed = await lapsedConstituents(
    person.id,
    records.filter(r => r.kind === 'CERTIFICATION' && r.state !== 'EXPIRED').map(r => r.moduleId),
    { warningWindowDays },
  )

  const [leadOf, sessionsDelivered] = await Promise.all([
    db.select({ department: schema.departmentLeads.department })
      .from(schema.departmentLeads)
      .where(eq(schema.departmentLeads.userId, person.id)).all(),
    db.select({ id: schema.sessions.id, heldOn: schema.sessions.heldOn })
      .from(schema.sessions)
      .where(eq(schema.sessions.trainerUserId, person.id))
      .orderBy(desc(schema.sessions.heldOn))
      .limit(10).all(),
  ])

  // Revoked records are history, not current standing — lead/admin only, so
  // a withdrawn certification isn't broadcast to the whole membership.
  const revoked = canSeeDrafts(abilities)
    ? await db.select({
        record: schema.records,
        moduleName: schema.modules.name,
      })
        .from(schema.records)
        .innerJoin(schema.modules, eq(schema.records.moduleId, schema.modules.id))
        .where(and(eq(schema.records.userId, person.id), isNotNull(schema.records.revokedAt)))
        .orderBy(desc(schema.records.revokedAt))
        .limit(50).all()
    : []

  return {
    person,
    leadOf: leadOf.map(l => l.department),
    records: records.filter(r => r.kind !== 'BRIEF').map(record => ({
      ...record,
      // Present only on certifications that need the caveat.
      lapsedConstituents: lapsed.get(record.moduleId) ?? null,
    })),
    briefs: records.filter(r => r.kind === 'BRIEF'),
    sessionsDelivered,
    revoked: revoked.map(r => ({
      id: r.record.id,
      moduleId: r.record.moduleId,
      moduleName: r.moduleName,
      awardedAt: r.record.awardedAt,
      revokedAt: r.record.revokedAt,
      revokeReason: r.record.revokeReason,
    })),
    can: {
      // Sign-off and external certs are per-department authority; revocation
      // is admin-only (docs/permissions.md).
      signOff: abilities.isAdmin || abilities.leadOf.length > 0,
      signOffDepartments: abilities.isAdmin ? null : abilities.leadOf,
      revoke: abilities.isAdmin,
    },
  }
})
