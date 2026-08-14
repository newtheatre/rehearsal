/**
 * GET /api/admin/audit — the audit trail.
 *
 * The runbook tells the ITM to review a month of this at handover and after
 * any suspected token leak; until now that meant opening wrangler. Read-only:
 * the table is append-only and nothing here writes to it.
 *
 * Actor ids are resolved to names where the person is still mirrored. A null
 * actor is the cron or an import, which is shown as such rather than blank —
 * "system" is a meaningful answer, "unknown" is not.
 */

import { db, schema } from '@nuxthub/db'
import { and, desc, eq, inArray, like, lt, or, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import { requireAdmin } from '../../utils/auth'

const querySchema = z.object({
  action: z.string().trim().max(60).optional(),
  actor: z.string().trim().max(64).optional(),
  q: z.string().trim().max(100).optional(),
  /** Epoch ms of the last row on the previous page. */
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const { action, actor, q, before, limit } = await getValidatedQuery(event, querySchema.parse)

  const conditions: (SQL | undefined)[] = []
  if (action) conditions.push(eq(schema.auditLog.action, action))
  if (actor) conditions.push(eq(schema.auditLog.actorUserId, actor))
  if (before) conditions.push(lt(schema.auditLog.createdAt, new Date(before)))
  if (q) {
    const pattern = `%${q}%`
    conditions.push(or(like(schema.auditLog.target, pattern), like(schema.auditLog.detail, pattern)))
  }

  const rows = await db.select().from(schema.auditLog)
    .where(conditions.length ? and(...conditions.filter(Boolean) as SQL[]) : undefined)
    .orderBy(desc(schema.auditLog.createdAt))
    // One extra row tells us whether there is another page without counting.
    .limit(limit + 1)
    .all()

  const page = rows.slice(0, limit)

  const actorIds = [...new Set(page.map(r => r.actorUserId).filter((id): id is string => Boolean(id)))]
  const actors = actorIds.length
    ? await db.select({ id: schema.users.id, name: schema.users.name })
        .from(schema.users).where(inArray(schema.users.id, actorIds)).all()
    : []
  const names = new Map(actors.map(a => [a.id, a.name]))

  // Distinct actions, for the filter — small and bounded by the code, so a
  // full scan of the column is cheaper than maintaining a list by hand.
  const allActions = await db.selectDistinct({ action: schema.auditLog.action })
    .from(schema.auditLog).all()

  return {
    entries: page.map(row => ({
      id: row.id,
      action: row.action,
      target: row.target,
      // Typed rather than left as JSON.parse's `any`: Nuxt's response
      // serialiser drops `any` properties, so the client would never see it.
      detail: (row.detail ? JSON.parse(row.detail) : null) as Record<string, unknown> | null,
      actorUserId: row.actorUserId,
      actorName: row.actorUserId ? names.get(row.actorUserId) ?? 'Deleted user' : null,
      createdAt: row.createdAt,
    })),
    actions: allActions.map(a => a.action).sort(),
    hasMore: rows.length > limit,
  }
})
