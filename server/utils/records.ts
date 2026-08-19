/**
 * The record engine. Expiry is stamped exactly once (ADR-0002); nothing here
 * deletes a record (ADR-0008). Atomicity is db.batch() (ADR-0009).
 */

import { db, schema } from '@nuxthub/db'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { computeExpiresAt } from './expiry'
import { notSupersededCondition, validityState, type ValidityState } from './validity'
// The catalogue owns this row type (server/utils/modules.ts); importing it
// rather than re-declaring keeps one name for one table.
import type { ModuleRow } from './modules'

export type RecordRow = typeof schema.records.$inferSelect
export type RecordSource = RecordRow['source']

export interface RecordInsert {
  id: string
  userId: string
  moduleId: string
  awardedAt: string
  expiresAt: string | null
  source: RecordSource
  sessionId?: string | null
  grantedBy?: string | null
  externalRef?: string | null
}

/**
 * Returns inserts rather than performing them, so the caller can batch them
 * with the session rows. Ids are generated here for that reason.
 */
export function buildRecordInserts(options: {
  users: string[]
  modules: ModuleRow[]
  awardedAt: string
  source: RecordSource
  sessionId?: string | null
  grantedBy?: string | null
  externalRef?: string | null
  /** An external certificate's own expiry, which always wins over config. */
  externalExpiresAt?: string | null
  academicYearEnd?: string
}): RecordInsert[] {
  const inserts: RecordInsert[] = []

  for (const userId of options.users) {
    for (const module of options.modules) {
      inserts.push({
        id: nanoid(),
        userId,
        moduleId: module.id,
        awardedAt: options.awardedAt,
        expiresAt: computeExpiresAt(module, options.awardedAt, {
          externalExpiresAt: options.externalExpiresAt,
          academicYearEnd: options.academicYearEnd,
        }),
        source: options.source,
        sessionId: options.sessionId ?? null,
        grantedBy: options.grantedBy ?? null,
        externalRef: options.externalRef ?? null,
      })
    }
  }

  return inserts
}

export interface PresentedRecord {
  id: string
  moduleId: string
  moduleName: string
  department: string
  kind: ModuleRow['kind']
  awardedAt: string
  expiresAt: string | null
  /** Absent for briefs, which never expire and never gate. */
  state: ValidityState | null
  source: RecordSource
  sessionId: string | null
  safetyCritical: boolean
}

function present(row: RecordRow, module: ModuleRow, warningWindowDays: number): PresentedRecord {
  return {
    id: row.id,
    moduleId: row.moduleId,
    moduleName: module.name,
    department: module.department,
    kind: module.kind,
    awardedAt: row.awardedAt,
    expiresAt: row.expiresAt,
    // A brief's "state" would be meaningless — it recurs per event, so the
    // person page shows when it was last received instead (ADR-0003).
    state: module.kind === 'BRIEF' ? null : validityState(row.expiresAt, { warningWindowDays }),
    source: row.source,
    sessionId: row.sessionId,
    safetyCritical: module.safetyCritical,
  }
}

/** Every current record for one person, with its derived state. */
export async function currentRecordsFor(
  userId: string,
  { warningWindowDays = 60 }: { warningWindowDays?: number } = {},
): Promise<PresentedRecord[]> {
  const rows = await db.select({ record: schema.records, module: schema.modules })
    .from(schema.records)
    .innerJoin(schema.modules, eq(schema.records.moduleId, schema.modules.id))
    .where(and(
      eq(schema.records.userId, userId),
      isNull(schema.records.revokedAt),
      notSupersededCondition(),
    ))
    .all()

  return rows
    .map(({ record, module }) => present(record, module, warningWindowDays))
    .sort((a, b) => a.department.localeCompare(b.department) || a.moduleId.localeCompare(b.moduleId))
}

/** Everyone currently holding a module, with state — the find-a-supervisor query. */
export async function holdersOf(
  moduleId: string,
  { warningWindowDays = 60 }: { warningWindowDays?: number } = {},
) {
  const rows = await db.select({
    record: schema.records,
    module: schema.modules,
    user: schema.users,
  })
    .from(schema.records)
    .innerJoin(schema.modules, eq(schema.records.moduleId, schema.modules.id))
    .innerJoin(schema.users, eq(schema.records.userId, schema.users.id))
    .where(and(
      eq(schema.records.moduleId, moduleId),
      isNull(schema.records.revokedAt),
      notSupersededCondition(),
    ))
    .all()

  return rows.map(({ record, module, user }) => ({
    userId: user.id,
    name: user.name,
    ...present(record, module, warningWindowDays),
  }))
}

/**
 * The current records for a set of (user, module) pairs — the bulk read the
 * prerequisite check and eligibility evaluation both need.
 */
export async function currentRecordsForModules(
  userId: string,
  moduleIds: string[],
  { warningWindowDays = 60 }: { warningWindowDays?: number } = {},
): Promise<Map<string, PresentedRecord>> {
  if (moduleIds.length === 0) return new Map()

  const rows = await db.select({ record: schema.records, module: schema.modules })
    .from(schema.records)
    .innerJoin(schema.modules, eq(schema.records.moduleId, schema.modules.id))
    .where(and(
      eq(schema.records.userId, userId),
      inArray(schema.records.moduleId, moduleIds),
      isNull(schema.records.revokedAt),
      notSupersededCondition(),
    ))
    .all()

  return new Map(rows.map(({ record, module }) => [
    module.id,
    present(record, module, warningWindowDays),
  ]))
}

/** Load modules by id, preserving the caller's order and rejecting unknowns. */
export async function loadModules(moduleIds: string[]): Promise<ModuleRow[]> {
  if (moduleIds.length === 0) return []

  const rows = await db.select().from(schema.modules)
    .where(inArray(schema.modules.id, moduleIds)).all()

  const byId = new Map(rows.map(m => [m.id, m]))
  const missing = moduleIds.filter(id => !byId.has(id))
  if (missing.length > 0) {
    throw createError({
      statusCode: 400,
      statusMessage: `Unknown module${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`,
    })
  }

  return moduleIds.map(id => byId.get(id)!)
}
