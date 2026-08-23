/**
 * The record engine. Expiry is stamped exactly once (ADR-0002); nothing here
 * deletes a record (ADR-0008). Atomicity is db.batch() (ADR-0009).
 */

import { db, schema } from '@nuxthub/db'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { computeExpiresAt, type ExpiryOverride } from './expiry'
import { chunk } from './d1'
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
  expiryOverridden: boolean
}

/**
 * One expiry cannot describe a users by modules fan-out, so an override is
 * only meaningful where exactly one record is being written (ADR-0012).
 */
function assertOverridable(options: {
  override?: ExpiryOverride
  source: RecordSource
  users: string[]
  modules: ModuleRow[]
}): void {
  if (!options.override) return

  if (options.source === 'SESSION') {
    throw createError({
      statusCode: 400,
      statusMessage: 'A session cannot set an expiry: it awards many people at once',
    })
  }

  if (options.users.length !== 1 || options.modules.length !== 1) {
    throw createError({
      statusCode: 400,
      statusMessage: 'An expiry override applies to a single record',
    })
  }
}

/**
 * Where a record may come from, by kind and status. Enforced here so every
 * creation path is covered by construction, not by remembering (ADR-0003).
 */
export function assertAwardable(modules: ModuleRow[], source: RecordSource): void {
  // LEGACY is the historical import: it records what happened, including on
  // modules since retired.
  if (source !== 'LEGACY') {
    const retired = modules.filter(m => m.status === 'RETIRED')
    if (retired.length > 0) {
      throw createError({
        statusCode: 400,
        statusMessage: `Retired, so no longer awardable: ${retired.map(m => m.id).join(', ')}`,
      })
    }
  }

  if (source === 'SESSION') {
    const certifications = modules.filter(m => m.signoffRequired)
    if (certifications.length > 0) {
      throw createError({
        statusCode: 400,
        statusMessage: `${certifications.map(m => m.id).join(', ')} must be signed off, not logged in a session`,
      })
    }
  }
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
  /** A certificate's or a signer's own date, which wins over policy. */
  override?: ExpiryOverride
  academicYearEnd?: string
}): RecordInsert[] {
  assertAwardable(options.modules, options.source)
  assertOverridable(options)

  const inserts: RecordInsert[] = []

  for (const userId of options.users) {
    for (const module of options.modules) {
      inserts.push({
        id: nanoid(),
        userId,
        moduleId: module.id,
        awardedAt: options.awardedAt,
        expiresAt: computeExpiresAt(module, options.awardedAt, {
          override: options.override,
          academicYearEnd: options.academicYearEnd,
        }),
        source: options.source,
        sessionId: options.sessionId ?? null,
        grantedBy: options.grantedBy ?? null,
        externalRef: options.externalRef ?? null,
        // EXTERNAL unconditionally, so the recalculation keeps the promise
        // the runbook makes about certificates (ADR-0012).
        expiryOverridden: options.override !== undefined || options.source === 'EXTERNAL',
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
  /** The date was set explicitly, so the recalculation will not move it. */
  expiryOverridden: boolean
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
    // A brief's "state" would be meaningless: it recurs per event, so the
    // person page shows when it was last received instead (ADR-0003).
    state: module.kind === 'BRIEF' ? null : validityState(row.expiresAt, { warningWindowDays }),
    source: row.source,
    sessionId: row.sessionId,
    safetyCritical: module.safetyCritical,
    expiryOverridden: row.expiryOverridden,
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

/** Everyone currently holding a module, with state: the find-a-supervisor query. */
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
 * The current records for a set of (user, module) pairs: the bulk read the
 * prerequisite check and eligibility evaluation both need.
 */
/**
 * The same read across a cohort, keyed `userId:moduleId`. Chunked so the
 * bound-parameter count never tracks the number of people (d1.ts).
 */
export async function currentRecordsForCohort(
  userIds: string[],
  moduleIds: string[],
  { warningWindowDays = 60 }: { warningWindowDays?: number } = {},
): Promise<Map<string, PresentedRecord>> {
  const held = new Map<string, PresentedRecord>()
  if (userIds.length === 0 || moduleIds.length === 0) return held

  for (const users of chunk(userIds, 45)) {
    for (const modules of chunk(moduleIds, 45)) {
      const rows = await db.select({ record: schema.records, module: schema.modules })
        .from(schema.records)
        .innerJoin(schema.modules, eq(schema.records.moduleId, schema.modules.id))
        .where(and(
          inArray(schema.records.userId, users),
          inArray(schema.records.moduleId, modules),
          isNull(schema.records.revokedAt),
          notSupersededCondition(),
        ))
        .all()

      for (const { record, module } of rows) {
        held.set(`${record.userId}:${module.id}`, present(record, module, warningWindowDays))
      }
    }
  }

  return held
}

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
