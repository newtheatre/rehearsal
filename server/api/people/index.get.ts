/**
 * GET /api/people — the member directory.
 */

import { db, schema } from '@nuxthub/db'
import { and, isNull, sql, eq } from 'drizzle-orm'
import { z } from 'zod'
import { useAbilities } from '../../utils/abilities'
import { getConfigNumber } from '../../utils/siteConfig'
import { validityState } from '../../utils/validity'

const querySchema = z.object({
  q: z.string().trim().max(100).optional(),
  module: z.string().trim().max(20).optional(),
})

export default defineEventHandler(async (event) => {
  await useAbilities(event)
  const { q, module } = await getValidatedQuery(event, querySchema.parse)
  const warningWindowDays = await getConfigNumber('warning_window_days')

  const users = await db.select({ id: schema.users.id, name: schema.users.name })
    .from(schema.users).all()

  // Current records for everyone, in one pass — the directory is tens of
  // people, so this is cheaper than a query per person.
  const records = await db.select({
    userId: schema.records.userId,
    moduleId: schema.records.moduleId,
    expiresAt: schema.records.expiresAt,
    kind: schema.modules.kind,
  })
    .from(schema.records)
    .innerJoin(schema.modules, eq(schema.records.moduleId, schema.modules.id))
    .where(and(
      isNull(schema.records.revokedAt),
      sql`not exists (
        select 1 from records later
        where later.user_id = ${schema.records.userId}
          and later.module_id = ${schema.records.moduleId}
          and later.revoked_at is null
          and (later.awarded_at > ${schema.records.awardedAt}
            or (later.awarded_at = ${schema.records.awardedAt} and later.created_at > ${schema.records.createdAt}))
      )`,
    ))
    .all()

  const byUser = new Map<string, { valid: number, expiring: number, expired: number, certifications: string[], modules: Set<string> }>()

  for (const record of records) {
    const entry = byUser.get(record.userId) ?? { valid: 0, expiring: 0, expired: 0, certifications: [], modules: new Set<string>() }
    entry.modules.add(record.moduleId)

    if (record.kind !== 'BRIEF') {
      const state = validityState(record.expiresAt, { warningWindowDays })
      if (state === 'VALID') entry.valid++
      else if (state === 'EXPIRING') entry.expiring++
      else entry.expired++

      if (record.kind === 'CERTIFICATION' && state !== 'EXPIRED') {
        entry.certifications.push(record.moduleId)
      }
    }

    byUser.set(record.userId, entry)
  }

  const people = users
    .filter(user => !q || user.name.toLowerCase().includes(q.toLowerCase()))
    .filter(user => !module || byUser.get(user.id)?.modules.has(module.toUpperCase()))
    .map((user) => {
      const entry = byUser.get(user.id)
      return {
        id: user.id,
        name: user.name,
        valid: entry?.valid ?? 0,
        expiring: entry?.expiring ?? 0,
        expired: entry?.expired ?? 0,
        certifications: entry?.certifications ?? [],
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  return { people }
})
