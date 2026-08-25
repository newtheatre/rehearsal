/**
 * Practice windows: this app answers whether somebody is being taught a
 * thing, and consumers enforce (ADR-0014). docs/scheduling-design.md §7
 */

import { db, schema } from '@nuxthub/db'
import { and, desc, eq, gt, isNull, lte } from 'drizzle-orm'
import { runAtomic, type BatchStatement } from './batch'
import { getConfigNumber } from './siteConfig'

export type PracticeTarget = typeof schema.practiceTargets.$inferSelect
export type PracticeWindow = typeof schema.practiceWindows.$inferSelect

export async function loadTarget(key: string): Promise<PracticeTarget | undefined> {
  return db.select().from(schema.practiceTargets)
    .where(eq(schema.practiceTargets.key, key)).get()
}

export async function listTargets(): Promise<PracticeTarget[]> {
  return db.select().from(schema.practiceTargets)
    .orderBy(schema.practiceTargets.key).all()
}

/**
 * Targets a session's modules would open. Usually none: most modules are in
 * no target, so a lighting-desk session opens nothing.
 */
export async function targetsForModules(moduleIds: string[]): Promise<PracticeTarget[]> {
  if (moduleIds.length === 0) return []

  const active = await db.select().from(schema.practiceTargets)
    .where(eq(schema.practiceTargets.status, 'ACTIVE')).all()

  const taught = new Set(moduleIds)
  return active.filter(target => target.moduleIds.some(id => taught.has(id)))
}

/** When a window opened now should shut, honouring the target's own override. */
export async function windowExpiry(
  target: PracticeTarget,
  endsAt: Date | null,
  now: Date = new Date(),
): Promise<Date> {
  const graceHours = target.graceHours ?? await getConfigNumber('practice_window_grace_hours')
  const base = endsAt && endsAt > now ? endsAt : now
  return new Date(base.getTime() + graceHours * 3_600_000)
}

export interface OpenWindowOptions {
  sessionId: string
  moduleIds: string[]
  userIds: string[]
  endsAt: Date | null
  openedBy: string
}

export interface OpenedWindows {
  statements: BatchStatement[]
  opened: { targetKey: string, userIds: string[] }[]
}

/**
 * One window per person per matching target, as statements the caller batches
 * with whatever must land alongside them.
 */
export async function openWindowStatements(options: OpenWindowOptions): Promise<OpenedWindows> {
  const targets = await targetsForModules(options.moduleIds)
  if (targets.length === 0 || options.userIds.length === 0) return { statements: [], opened: [] }

  const now = new Date()
  const statements: BatchStatement[] = []
  const opened: { targetKey: string, userIds: string[] }[] = []

  for (const target of targets) {
    // Resolved here, not mid-batch: it reads site config, and a batch is built
    // before any of it runs.
    const expiresAt = await windowExpiry(target, options.endsAt, now)
    for (const userId of options.userIds) {
      statements.push(db.insert(schema.practiceWindows).values({
        userId,
        targetKey: target.key,
        sessionId: options.sessionId,
        openedBy: options.openedBy,
        opensAt: now,
        expiresAt,
      }))
    }
    opened.push({ targetKey: target.key, userIds: options.userIds })
  }

  return { statements, opened }
}

/**
 * Open them on their own. Returns what it opened so a caller can say which
 * sandboxes it unlocked, or that there were none.
 */
export async function openWindowsForSession(
  options: OpenWindowOptions,
): Promise<{ targetKey: string, userIds: string[] }[]> {
  const { statements, opened } = await openWindowStatements(options)
  await runAtomic(statements)
  return opened
}

/** Statements closing a session's windows, for the caller to batch. */
export function closeSessionWindowStatements(sessionId: string, closedBy: string, now = new Date()): BatchStatement[] {
  return [
    db.update(schema.practiceWindows)
      .set({ closedAt: now, closedBy })
      .where(and(
        eq(schema.practiceWindows.sessionId, sessionId),
        isNull(schema.practiceWindows.closedAt),
      )),
  ]
}

/** Statements closing one person's windows on a session, for the caller to batch. */
export function closeAttendeeWindowStatements(
  sessionId: string,
  userId: string,
  closedBy: string,
  now = new Date(),
): BatchStatement[] {
  return [
    db.update(schema.practiceWindows)
      .set({ closedAt: now, closedBy })
      .where(and(
        eq(schema.practiceWindows.sessionId, sessionId),
        eq(schema.practiceWindows.userId, userId),
        isNull(schema.practiceWindows.closedAt),
      )),
  ]
}

/**
 * Open means not closed, inside its window, and on a target that has not been
 * retired underneath it. Both readers below use this one definition.
 */
function openWindowFilter(now: Date) {
  return and(
    eq(schema.practiceTargets.status, 'ACTIVE'),
    isNull(schema.practiceWindows.closedAt),
    lte(schema.practiceWindows.opensAt, now),
    gt(schema.practiceWindows.expiresAt, now),
  )
}

/** The one question consumers ask. */
export async function hasOpenWindow(
  userId: string,
  targetKey: string,
  now: Date = new Date(),
): Promise<PracticeWindow | undefined> {
  return db.select({ window: schema.practiceWindows })
    .from(schema.practiceWindows)
    .innerJoin(schema.practiceTargets, eq(schema.practiceWindows.targetKey, schema.practiceTargets.key))
    .where(and(
      eq(schema.practiceWindows.userId, userId),
      eq(schema.practiceWindows.targetKey, targetKey),
      openWindowFilter(now),
    ))
    // Longest-lived first, so holding two windows never shortens the answer.
    .orderBy(desc(schema.practiceWindows.expiresAt), desc(schema.practiceWindows.id))
    .get()
    .then(row => row?.window)
}

/** The targets a session actually has live windows on, not merely matching ones. */
export async function openTargetKeysForSession(sessionId: string, now: Date = new Date()): Promise<string[]> {
  const rows = await db.selectDistinct({ targetKey: schema.practiceWindows.targetKey })
    .from(schema.practiceWindows)
    .innerJoin(schema.practiceTargets, eq(schema.practiceWindows.targetKey, schema.practiceTargets.key))
    .where(and(eq(schema.practiceWindows.sessionId, sessionId), openWindowFilter(now)))
    .all()

  return rows.map(row => row.targetKey).sort()
}

/** Every open window, for the lead's view of what is currently unlocked. */
export async function openWindows(now: Date = new Date()) {
  return db.select({
    id: schema.practiceWindows.id,
    userId: schema.practiceWindows.userId,
    userName: schema.users.name,
    targetKey: schema.practiceWindows.targetKey,
    sessionId: schema.practiceWindows.sessionId,
    expiresAt: schema.practiceWindows.expiresAt,
    reason: schema.practiceWindows.reason,
  })
    .from(schema.practiceWindows)
    .innerJoin(schema.users, eq(schema.practiceWindows.userId, schema.users.id))
    .innerJoin(schema.practiceTargets, eq(schema.practiceWindows.targetKey, schema.practiceTargets.key))
    .where(openWindowFilter(now))
    .orderBy(desc(schema.practiceWindows.expiresAt))
    .all()
}

/** A lead opening one by hand, for coaching outside a scheduled session. */
export async function grantWindow(options: {
  userId: string
  targetKey: string
  hours: number
  reason: string
  openedBy: string
}): Promise<{ id: string, expiresAt: Date }> {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + options.hours * 3_600_000)

  const [row] = await db.insert(schema.practiceWindows).values({
    userId: options.userId,
    targetKey: options.targetKey,
    sessionId: null,
    openedBy: options.openedBy,
    opensAt: now,
    expiresAt,
    reason: options.reason,
  }).returning({ id: schema.practiceWindows.id })

  return { id: row!.id, expiresAt }
}

export async function closeWindow(id: string, closedBy: string): Promise<void> {
  await db.update(schema.practiceWindows)
    .set({ closedAt: new Date(), closedBy })
    .where(and(eq(schema.practiceWindows.id, id), isNull(schema.practiceWindows.closedAt)))
}

/** Tidy up anything left open past its expiry. Closing is not a sanction. */
export async function sweepExpiredWindows(now: Date = new Date()): Promise<number> {
  const closed = await db.update(schema.practiceWindows)
    .set({ closedAt: now })
    .where(and(
      isNull(schema.practiceWindows.closedAt),
      lte(schema.practiceWindows.expiresAt, now),
    ))
    .returning({ id: schema.practiceWindows.id })

  return closed.length
}

/** Targets that name a module, so the catalogue page can say a sandbox exists. */
export async function targetsNaming(moduleIds: string[]): Promise<Map<string, string[]>> {
  const byModule = new Map<string, string[]>()
  if (moduleIds.length === 0) return byModule

  const active = await db.select().from(schema.practiceTargets)
    .where(eq(schema.practiceTargets.status, 'ACTIVE')).all()

  for (const moduleId of moduleIds) {
    const keys = active.filter(target => target.moduleIds.includes(moduleId)).map(target => target.key)
    if (keys.length) byModule.set(moduleId, keys)
  }
  return byModule
}
