/**
 * Prerequisite evaluation. Hard at certification sign-off (invariant 5),
 * advisory when logging a session except for safety-critical modules.
 */

import { db, schema } from '@nuxthub/db'
import { eq, inArray } from 'drizzle-orm'
import { countsAsValid } from './validity'
import { currentRecordsForCohort, currentRecordsForModules } from './records'
import { chunk } from './d1'

export interface PrerequisiteGap {
  moduleId: string
  name: string
  /** null = never held it at all; otherwise the state of the record they do have. */
  state: 'EXPIRED' | null
}

export interface PrerequisiteCheck {
  met: boolean
  missing: PrerequisiteGap[]
}

/** Direct prerequisites of a module (not transitive, see the note below). */
export async function prerequisiteIdsOf(moduleId: string): Promise<string[]> {
  const rows = await db.select({ id: schema.modulePrerequisites.requiresModuleId })
    .from(schema.modulePrerequisites)
    .where(eq(schema.modulePrerequisites.moduleId, moduleId))
    .all()
  return rows.map(r => r.id)
}

/** Prerequisite edges for many modules at once, as moduleId to required ids. */
export async function prerequisiteIdsForModules(moduleIds: string[]): Promise<Map<string, string[]>> {
  const edges = new Map<string, string[]>(moduleIds.map(id => [id, []]))
  if (moduleIds.length === 0) return edges

  for (const batch of chunk(moduleIds)) {
    const rows = await db.select({
      moduleId: schema.modulePrerequisites.moduleId,
      requiresModuleId: schema.modulePrerequisites.requiresModuleId,
    })
      .from(schema.modulePrerequisites)
      .where(inArray(schema.modulePrerequisites.moduleId, batch))
      .all()

    for (const row of rows) edges.get(row.moduleId)?.push(row.requiresModuleId)
  }

  return edges
}

/**
 * Every (person, module) pair in one pass. Two queries regardless of cohort
 * size, where the per-pair check cost one to three each.
 */
export async function checkPrerequisitesForCohort(
  userIds: string[],
  moduleIds: string[],
  { warningWindowDays = 60 }: { warningWindowDays?: number } = {},
): Promise<Map<string, PrerequisiteCheck>> {
  const results = new Map<string, PrerequisiteCheck>()
  if (userIds.length === 0 || moduleIds.length === 0) return results

  const edges = await prerequisiteIdsForModules(moduleIds)
  const required = [...new Set([...edges.values()].flat())]

  if (required.length === 0) {
    for (const userId of userIds) {
      for (const moduleId of moduleIds) results.set(`${userId}:${moduleId}`, { met: true, missing: [] })
    }
    return results
  }

  const [held, names] = await Promise.all([
    currentRecordsForCohort(userIds, required, { warningWindowDays }),
    moduleNames(required),
  ])

  for (const userId of userIds) {
    for (const moduleId of moduleIds) {
      const missing = gapsFor(edges.get(moduleId) ?? [], id => held.get(`${userId}:${id}`), names)
      results.set(`${userId}:${moduleId}`, { met: missing.length === 0, missing })
    }
  }

  return results
}

async function moduleNames(moduleIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  for (const batch of chunk(moduleIds)) {
    const rows = await db.select({ id: schema.modules.id, name: schema.modules.name })
      .from(schema.modules).where(inArray(schema.modules.id, batch)).all()
    for (const row of rows) names.set(row.id, row.name)
  }
  return names
}

/** The one place a held-or-not decision becomes a gap, for both call paths. */
function gapsFor(
  required: string[],
  lookup: (moduleId: string) => { state: 'VALID' | 'EXPIRING' | 'EXPIRED' | null } | undefined,
  names: Map<string, string>,
): PrerequisiteGap[] {
  const missing: PrerequisiteGap[] = []

  for (const requiredId of required) {
    const record = lookup(requiredId)
    // A brief has no state and cannot gate anything; treat it as held so a
    // catalogue mistake can't make a certification unobtainable.
    if (record && (record.state === null || countsAsValid(record.state))) continue

    missing.push({
      moduleId: requiredId,
      name: names.get(requiredId) ?? requiredId,
      state: record ? 'EXPIRED' : null,
    })
  }

  return missing
}

/**
 * Direct prerequisites only, not the transitive closure: the catalogue
 * already chains them. Deepening the rule is a policy change with an ADR.
 */
export async function checkPrerequisites(
  userId: string,
  moduleId: string,
  { warningWindowDays = 60 }: { warningWindowDays?: number } = {},
): Promise<PrerequisiteCheck> {
  const required = await prerequisiteIdsOf(moduleId)
  if (required.length === 0) return { met: true, missing: [] }

  const [held, modules] = await Promise.all([
    currentRecordsForModules(userId, required, { warningWindowDays }),
    db.select({ id: schema.modules.id, name: schema.modules.name })
      .from(schema.modules).where(inArray(schema.modules.id, required)).all(),
  ])

  const names = new Map(modules.map(m => [m.id, m.name]))
  const missing = gapsFor(required, id => held.get(id), names)

  return { met: missing.length === 0, missing }
}

/**
 * A certification whose constituent modules have lapsed stays valid: v1 does
 * not auto-suspend, but says so on the person's page.
 */
export async function lapsedConstituents(
  userId: string,
  certificationIds: string[],
  { warningWindowDays = 60 }: { warningWindowDays?: number } = {},
): Promise<Map<string, PrerequisiteGap[]>> {
  const flagged = new Map<string, PrerequisiteGap[]>()
  const checks = await checkPrerequisitesForCohort([userId], certificationIds, { warningWindowDays })

  for (const moduleId of certificationIds) {
    const check = checks.get(`${userId}:${moduleId}`)
    if (check && !check.met) flagged.set(moduleId, check.missing)
  }

  return flagged
}

/** Human-readable gap list for an error message. */
export function describeGaps(missing: PrerequisiteGap[]): string {
  return missing
    .map(gap => `${gap.moduleId} ${gap.name}${gap.state === 'EXPIRED' ? ' (expired)' : ''}`)
    .join(', ')
}
