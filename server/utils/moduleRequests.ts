/**
 * Demand signals. A request creates no obligation and nothing on a timer
 * resolves one. docs/scheduling-design.md §4
 */

import { db, schema } from '@nuxthub/db'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { runAtomic } from './batch'
import { chunk } from './d1'

export type RequestRow = typeof schema.moduleRequests.$inferSelect

export interface DemandRow {
  moduleId: string
  moduleName: string
  department: string
  openCount: number
  /** Names, for a lead deciding whether a session is worth an evening. */
  requesters: { id: string, name: string, note: string | null }[]
}

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

/** One person's own requests, newest first. */
export async function requestsFor(userId: string) {
  return db.select({
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
    .orderBy(desc(schema.moduleRequests.createdAt))
    .all()
}

/**
 * The demand board, busiest first. Scoped to `departments` unless it is null,
 * which is an admin seeing everything.
 */
export async function demandBoard(departments: string[] | null): Promise<DemandRow[]> {
  const scope = departments === null
    ? undefined
    : departments.length === 0
      ? sql`1 = 0`
      : inArray(schema.modules.department, departments)

  const rows = await db.select({
    moduleId: schema.moduleRequests.moduleId,
    moduleName: schema.modules.name,
    department: schema.modules.department,
    userId: schema.moduleRequests.userId,
    userName: schema.users.name,
    note: schema.moduleRequests.note,
  })
    .from(schema.moduleRequests)
    .innerJoin(schema.modules, eq(schema.moduleRequests.moduleId, schema.modules.id))
    .innerJoin(schema.users, eq(schema.moduleRequests.userId, schema.users.id))
    .where(and(eq(schema.moduleRequests.status, 'OPEN'), scope))
    .all()

  const byModule = new Map<string, Omit<DemandRow, 'openCount'>>()
  for (const row of rows) {
    const entry = byModule.get(row.moduleId) ?? {
      moduleId: row.moduleId,
      moduleName: row.moduleName,
      department: row.department,
      requesters: [],
    }
    entry.requesters.push({ id: row.userId, name: row.userName, note: row.note })
    byModule.set(row.moduleId, entry)
  }

  return [...byModule.values()]
    .map(entry => ({ ...entry, openCount: entry.requesters.length }))
    .sort((a, b) => b.openCount - a.openCount || a.moduleId.localeCompare(b.moduleId))
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
