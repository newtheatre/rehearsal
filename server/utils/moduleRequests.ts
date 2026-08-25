/**
 * Demand signals. A request creates no obligation and nothing on a timer
 * resolves one. docs/scheduling-design.md §4
 */

import { db, schema } from '@nuxthub/db'
import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm'
import { runAtomic } from './batch'
import { chunk } from './d1'

export type RequestRow = typeof schema.moduleRequests.$inferSelect

export interface DemandRow {
  moduleId: string
  moduleName: string
  department: string
  /** Every open request for the module, not the number of names below. */
  openCount: number
  /** Names, for a lead deciding whether a session is worth an evening.
   * `requestId` is what the decline route takes; `id` is the person. */
  requesters: { id: string, requestId: string, name: string, note: string | null }[]
  /** Open requests past the per-module cap, so the page can say how many. */
  requestersNotShown: number
}

/** Modules per page of the board, and names under each. Both bound the read. */
export const BOARD_MODULE_LIMIT = 25
export const BOARD_REQUESTERS_PER_MODULE = 10

/** Raise a request, or refuse because one is already open. */
export async function requestModule(options: {
  userId: string
  moduleId: string
  note?: string | null
}): Promise<{ id: string }> {
  const existing = await db.select({ id: schema.moduleRequests.id })
    .from(schema.moduleRequests)
    .where(and(
      eq(schema.moduleRequests.userId, options.userId),
      eq(schema.moduleRequests.moduleId, options.moduleId),
      eq(schema.moduleRequests.status, 'OPEN'),
    ))
    .get()

  if (existing) {
    throw createError({
      statusCode: 409,
      statusMessage: 'You have already asked for that one',
    })
  }

  const [row] = await db.insert(schema.moduleRequests).values({
    userId: options.userId,
    moduleId: options.moduleId,
    note: options.note ?? null,
  }).returning({ id: schema.moduleRequests.id })

  return { id: row!.id }
}

/** One person's own requests, newest first. Paged in SQL, like every list. */
export async function requestsFor(userId: string, { limit = 50 }: { limit?: number } = {}) {
  const rows = await db.select({
    id: schema.moduleRequests.id,
    moduleId: schema.moduleRequests.moduleId,
    moduleName: schema.modules.name,
    department: schema.modules.department,
    note: schema.moduleRequests.note,
    status: schema.moduleRequests.status,
    declineReason: schema.moduleRequests.declineReason,
    resolvedSessionId: schema.moduleRequests.resolvedSessionId,
    createdAt: schema.moduleRequests.createdAt,
  })
    .from(schema.moduleRequests)
    .innerJoin(schema.modules, eq(schema.moduleRequests.moduleId, schema.modules.id))
    .where(eq(schema.moduleRequests.userId, userId))
    .orderBy(desc(schema.moduleRequests.createdAt), desc(schema.moduleRequests.id))
    // One extra row says whether there is another page without counting.
    .limit(limit + 1)
    .all()

  return { requests: rows.slice(0, limit), hasMore: rows.length > limit }
}

/**
 * The demand board, busiest first. Scoped to `departments` unless it is null,
 * which is an admin seeing everything. docs/api-reference.md
 */
export async function demandBoard(
  departments: string[] | null,
  options: { limit?: number, requestersPerModule?: number } = {},
): Promise<{ modules: DemandRow[], hasMore: boolean }> {
  const limit = options.limit ?? BOARD_MODULE_LIMIT
  const perModule = options.requestersPerModule ?? BOARD_REQUESTERS_PER_MODULE

  const scope = departments === null
    ? undefined
    : departments.length === 0
      ? sql`1 = 0`
      : inArray(schema.modules.department, departments)
  const match = and(eq(schema.moduleRequests.status, 'OPEN'), scope)

  // Counted in SQL: an openCount worked out from one page of requesters would
  // be a smaller number than the truth, on the figure a lead decides from.
  const counted = await db.select({
    moduleId: schema.moduleRequests.moduleId,
    moduleName: schema.modules.name,
    department: schema.modules.department,
    openCount: sql<number>`count(*)`.as('open_count'),
  })
    .from(schema.moduleRequests)
    .innerJoin(schema.modules, eq(schema.moduleRequests.moduleId, schema.modules.id))
    .where(match)
    .groupBy(schema.moduleRequests.moduleId)
    .orderBy(desc(sql`count(*)`), asc(schema.moduleRequests.moduleId))
    // One extra row says whether there is another page without counting.
    .limit(limit + 1)
    .all()

  const page = counted.slice(0, limit)
  if (page.length === 0) return { modules: [], hasMore: false }

  // A subquery, never the ids just returned: an IN list built from a result
  // set binds one parameter per row and blows D1's cap of 100.
  const pageModules = db.select({ moduleId: schema.moduleRequests.moduleId })
    .from(schema.moduleRequests)
    .innerJoin(schema.modules, eq(schema.moduleRequests.moduleId, schema.modules.id))
    .where(match)
    .groupBy(schema.moduleRequests.moduleId)
    .orderBy(desc(sql`count(*)`), asc(schema.moduleRequests.moduleId))
    .limit(limit)

  const ranked = db.select({
    requestId: schema.moduleRequests.id,
    moduleId: schema.moduleRequests.moduleId,
    userId: schema.moduleRequests.userId,
    userName: schema.users.name,
    note: schema.moduleRequests.note,
    rank: sql<number>`row_number() over (
      partition by ${schema.moduleRequests.moduleId}
      order by ${schema.moduleRequests.createdAt}, ${schema.moduleRequests.id}
    )`.as('rank'),
  })
    .from(schema.moduleRequests)
    .innerJoin(schema.users, eq(schema.moduleRequests.userId, schema.users.id))
    .where(and(
      eq(schema.moduleRequests.status, 'OPEN'),
      inArray(schema.moduleRequests.moduleId, pageModules),
    ))
    .as('ranked')

  // Capped in SQL as well: one popular module must not decide the payload.
  const rows = await db.select().from(ranked).where(lte(ranked.rank, perModule)).all()

  const named = new Map<string, DemandRow['requesters']>()
  for (const row of rows) {
    const list = named.get(row.moduleId) ?? []
    list.push({ id: row.userId, requestId: row.requestId, name: row.userName, note: row.note })
    named.set(row.moduleId, list)
  }

  return {
    modules: page.map((entry) => {
      const requesters = named.get(entry.moduleId) ?? []
      return {
        moduleId: entry.moduleId,
        moduleName: entry.moduleName,
        department: entry.department,
        openCount: Number(entry.openCount),
        requesters,
        requestersNotShown: Math.max(0, Number(entry.openCount) - requesters.length),
      }
    }),
    hasMore: counted.length > limit,
  }
}

/** Open request counts per module, for the catalogue pages. */
export async function openDemandFor(moduleIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (moduleIds.length === 0) return counts

  for (const batch of chunk(moduleIds)) {
    const rows = await db.select({
      moduleId: schema.moduleRequests.moduleId,
      count: sql<number>`count(*)`.as('count'),
    })
      .from(schema.moduleRequests)
      .where(and(
        inArray(schema.moduleRequests.moduleId, batch),
        eq(schema.moduleRequests.status, 'OPEN'),
      ))
      .groupBy(schema.moduleRequests.moduleId)
      .all()

    for (const row of rows) counts.set(row.moduleId, Number(row.count))
  }
  return counts
}

/**
 * Close the open requests a newly scheduled session answers, and return who
 * to tell. Called only when a human schedules something.
 */
export async function resolveRequestsFor(options: {
  moduleIds: string[]
  sessionId: string
  actorUserId: string
}): Promise<string[]> {
  if (options.moduleIds.length === 0) return []

  const open = await db.select({
    id: schema.moduleRequests.id,
    userId: schema.moduleRequests.userId,
  })
    .from(schema.moduleRequests)
    .where(and(
      inArray(schema.moduleRequests.moduleId, options.moduleIds),
      eq(schema.moduleRequests.status, 'OPEN'),
    ))
    .all()

  if (open.length === 0) return []

  const now = new Date()
  // Scoped by the ids the select saw, chunked, so the batch's statement count
  // does not grow with the number of requesters.
  await runAtomic(chunk(open.map(row => row.id)).map(ids =>
    db.update(schema.moduleRequests).set({
      status: 'SCHEDULED',
      resolvedSessionId: options.sessionId,
      resolvedAt: now,
      resolvedBy: options.actorUserId,
    }).where(inArray(schema.moduleRequests.id, ids)),
  ))

  return [...new Set(open.map(row => row.userId))]
}
