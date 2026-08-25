/**
 * GET /api/people: the member directory.
 */

import { db, schema } from '@nuxthub/db'
import { and, asc, eq, gt, inArray, isNull, like, or } from 'drizzle-orm'
import { z } from 'zod'
import { useAbilities } from '../../utils/abilities'
import { getConfigNumber } from '../../utils/siteConfig'
import { notSupersededCondition, validityState } from '../../utils/validity'
import { chunk } from '../../utils/d1'

const querySchema = z.object({
  q: z.string().trim().max(100).optional(),
  module: z.string().trim().max(20).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  /** Both taken from the last row of the previous page. */
  afterName: z.string().trim().max(200).optional(),
  afterId: z.string().trim().max(64).optional(),
})

export default defineEventHandler(async (event) => {
  await useAbilities(event)
  const { q, module, limit, afterName, afterId } = await getValidatedQuery(event, querySchema.parse)
  const warningWindowDays = await getConfigNumber('warning_window_days')

  // Filtering and paging happen in SQL: the directory grows with the membership
  // and nothing here may load all of it.
  const holdsModule = module
    ? inArray(
        schema.users.id,
        db.select({ userId: schema.records.userId })
          .from(schema.records)
          .where(and(
            eq(schema.records.moduleId, module.toUpperCase()),
            isNull(schema.records.revokedAt),
            notSupersededCondition(),
          )),
      )
    : undefined

  // Keyset on (name, id): names are not unique.
  const cursor = afterName && afterId
    ? or(
        gt(schema.users.name, afterName),
        and(eq(schema.users.name, afterName), gt(schema.users.id, afterId)),
      )
    : undefined

  const rows = await db.select({ id: schema.users.id, name: schema.users.name })
    .from(schema.users)
    .where(and(
      // A merged-away row holds no records and is nobody to look up.
      isNull(schema.users.mergedInto),
      q ? like(schema.users.name, `%${q}%`) : undefined,
      holdsModule,
      cursor,
    ))
    .orderBy(asc(schema.users.name), asc(schema.users.id))
    // One extra row says whether there is another page without counting.
    .limit(limit + 1)
    .all()

  const page = rows.slice(0, limit)
  const hasMore = rows.length > limit

  const records = page.length
    ? (await Promise.all(chunk(page.map(u => u.id)).map(batch =>
        db.select({
          userId: schema.records.userId,
          moduleId: schema.records.moduleId,
          expiresAt: schema.records.expiresAt,
          kind: schema.modules.kind,
        })
          .from(schema.records)
          .innerJoin(schema.modules, eq(schema.records.moduleId, schema.modules.id))
          .where(and(
            inArray(schema.records.userId, batch),
            isNull(schema.records.revokedAt),
            notSupersededCondition(),
          ))
          .all(),
      ))).flat()
    : []

  const byUser = new Map<string, { valid: number, expiring: number, expired: number, certifications: string[] }>()

  for (const record of records) {
    if (record.kind === 'BRIEF') continue

    const entry = byUser.get(record.userId) ?? { valid: 0, expiring: 0, expired: 0, certifications: [] }
    const state = validityState(record.expiresAt, { warningWindowDays })

    if (state === 'VALID') entry.valid++
    else if (state === 'EXPIRING') entry.expiring++
    else entry.expired++

    if (record.kind === 'CERTIFICATION' && state !== 'EXPIRED') {
      entry.certifications.push(record.moduleId)
    }

    byUser.set(record.userId, entry)
  }

  return {
    people: page.map(user => ({
      id: user.id,
      name: user.name,
      valid: byUser.get(user.id)?.valid ?? 0,
      expiring: byUser.get(user.id)?.expiring ?? 0,
      expired: byUser.get(user.id)?.expired ?? 0,
      certifications: byUser.get(user.id)?.certifications ?? [],
    })),
    hasMore,
  }
})
