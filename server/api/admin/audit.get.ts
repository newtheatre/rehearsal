/**
 * GET /api/admin/audit: the audit trail.
 */

import { db, schema } from '@nuxthub/db'
import { and, desc, eq, inArray, like, lt, or, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import { requirePermission } from '../../utils/auth'
import { chunk } from '../../utils/d1'

const querySchema = z.object({
  action: z.string().trim().max(60).optional(),
  actor: z.string().trim().max(64).optional(),
  q: z.string().trim().max(100).optional(),
  /** Epoch ms of the last row on the previous page, with its id to break ties. */
  before: z.coerce.number().int().positive().optional(),
  beforeId: z.string().trim().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'config.manage')
  const { action, actor, q, before, beforeId, limit } = await getValidatedQuery(event, querySchema.parse)

  const conditions: (SQL | undefined)[] = []
  if (action) conditions.push(eq(schema.auditLog.action, action))
  if (actor) conditions.push(eq(schema.auditLog.actorUserId, actor))
  if (before) {
    // Keyed on (created_at, id): rows sharing a millisecond would otherwise
    // fall between pages and be unreachable.
    const at = new Date(before)
    conditions.push(beforeId
      ? or(lt(schema.auditLog.createdAt, at),
          and(eq(schema.auditLog.createdAt, at), lt(schema.auditLog.id, beforeId)))
      : lt(schema.auditLog.createdAt, at))
  }
  if (q) {
    const pattern = `%${q}%`
    conditions.push(or(like(schema.auditLog.target, pattern), like(schema.auditLog.detail, pattern)))
  }

  const rows = await db.select().from(schema.auditLog)
    .where(conditions.length ? and(...conditions.filter(Boolean) as SQL[]) : undefined)
    .orderBy(desc(schema.auditLog.createdAt), desc(schema.auditLog.id))
    // One extra row tells us whether there is another page without counting.
    .limit(limit + 1)
    .all()

  const page = rows.slice(0, limit)

  const actorIds = [...new Set(page.map(r => r.actorUserId).filter((id): id is string => Boolean(id)))]
  // A 200-row page can name more actors than D1 will bind at once (d1.ts).
  const actors = (await Promise.all(
    chunk(actorIds).map(batch =>
      db.select({ id: schema.users.id, name: schema.users.name })
        .from(schema.users).where(inArray(schema.users.id, batch)).all(),
    ),
  )).flat()
  const names = new Map(actors.map(a => [a.id, a.name]))

  // Distinct actions, for the filter: small and bounded by the code, so a
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
