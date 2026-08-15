/**
 * The single retroactive path (ADR-0002): previewed as a diff, confirmed by
 * typing, audit-logged. EXTERNAL and revoked records are never touched.
 */

import { db, schema } from '@nuxthub/db'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { computeExpiresAt } from './expiry'

export interface ExpiryChange {
  recordId: string
  userId: string
  userName: string
  moduleId: string
  moduleName: string
  awardedAt: string
  from: string | null
  to: string | null
}

export interface RecalculationPlan {
  changes: ExpiryChange[]
  unchanged: number
  /** EXTERNAL records skipped on purpose, so the count is explainable. */
  skippedExternal: number
}

/**
 * Which current records would have a different expiry under each module's
 * present policy. Scoped to one module when given.
 */
export async function planRecalculation(
  { moduleId, academicYearEnd }: { moduleId?: string, academicYearEnd: string },
): Promise<RecalculationPlan> {
  const rows = await db.select({
    record: schema.records,
    module: schema.modules,
    userName: schema.users.name,
  })
    .from(schema.records)
    .innerJoin(schema.modules, eq(schema.records.moduleId, schema.modules.id))
    .innerJoin(schema.users, eq(schema.records.userId, schema.users.id))
    .where(and(
      isNull(schema.records.revokedAt),
      moduleId ? eq(schema.records.moduleId, moduleId) : undefined,
      // Current records only — rewriting a superseded row's expiry would
      // change history that nothing reads.
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

  const changes: ExpiryChange[] = []
  let unchanged = 0
  let skippedExternal = 0

  for (const { record, module, userName } of rows) {
    if (record.source === 'EXTERNAL') {
      skippedExternal++
      continue
    }

    const next = computeExpiresAt(module, record.awardedAt, { academicYearEnd })
    if (next === record.expiresAt) {
      unchanged++
      continue
    }

    changes.push({
      recordId: record.id,
      userId: record.userId,
      userName,
      moduleId: record.moduleId,
      moduleName: module.name,
      awardedAt: record.awardedAt,
      from: record.expiresAt,
      to: next,
    })
  }

  changes.sort((a, b) => a.moduleId.localeCompare(b.moduleId) || a.userName.localeCompare(b.userName))
  return { changes, unchanged, skippedExternal }
}

/**
 * Apply a previewed plan. Returns how many rows moved.
 */
export async function applyRecalculation(changes: ExpiryChange[]): Promise<number> {
  for (const change of changes) {
    await db.update(schema.records)
      .set({ expiresAt: change.to })
      .where(eq(schema.records.id, change.recordId))
  }
  return changes.length
}
