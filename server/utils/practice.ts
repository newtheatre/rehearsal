/**
 * Practice windows: this app answers whether somebody is being taught a
 * thing, and consumers enforce (ADR-0014). docs/scheduling-design.md §7
 */

import { db, schema } from '@nuxthub/db'
import { and, eq, gt, isNull, lte } from 'drizzle-orm'
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

/**
 * Open one window per person per matching target. Returns what it opened so
 * the register can say which sandboxes it unlocked, or that there were none.
 */
export async function openWindowsForSession(options: {
  sessionId: string
  moduleIds: string[]
  userIds: string[]
  endsAt: Date | null
  openedBy: string
}): Promise<{ targetKey: string, userIds: string[] }[]> {
  const targets = await targetsForModules(options.moduleIds)
  if (targets.length === 0 || options.userIds.length === 0) return []

  const now = new Date()
  const statements: BatchStatement[] = []
  const opened: { targetKey: string, userIds: string[] }[] = []

  for (const target of targets) {
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

/**
 * The one question consumers ask. Open means not closed, inside its window,
 * and on a target that has not been retired underneath it.
 */
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
      eq(schema.practiceTargets.status, 'ACTIVE'),
      isNull(schema.practiceWindows.closedAt),
      lte(schema.practiceWindows.opensAt, now),
      gt(schema.practiceWindows.expiresAt, now),
    ))
    .get()
    .then(row => row?.window)
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
    .where(and(
      isNull(schema.practiceWindows.closedAt),
      gt(schema.practiceWindows.expiresAt, now),
    ))
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
  const stale = await db.select({ id: schema.practiceWindows.id })
    .from(schema.practiceWindows)
    .where(and(
      isNull(schema.practiceWindows.closedAt),
      lte(schema.practiceWindows.expiresAt, now),
    ))
    .all()

  if (stale.length === 0) return 0

  await db.update(schema.practiceWindows)
    .set({ closedAt: now })
    .where(and(
      isNull(schema.practiceWindows.closedAt),
      lte(schema.practiceWindows.expiresAt, now),
    ))

  return stale.length
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
