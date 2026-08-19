/**
 * Prerequisite evaluation. Hard at certification sign-off (invariant 5),
 * advisory when logging a session except for safety-critical modules.
 */

import { db, schema } from '@nuxthub/db'
import { eq, inArray } from 'drizzle-orm'
import { countsAsValid } from './validity'
import { currentRecordsForModules } from './records'

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
  const missing: PrerequisiteGap[] = []

  for (const requiredId of required) {
    const record = held.get(requiredId)
    // A brief has no state and cannot gate anything; treat it as held so a
    // catalogue mistake can't make a certification unobtainable.
    if (record && (record.state === null || countsAsValid(record.state))) continue

    missing.push({
      moduleId: requiredId,
      name: names.get(requiredId) ?? requiredId,
      state: record ? 'EXPIRED' : null,
    })
  }

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

  for (const moduleId of certificationIds) {
    const { met, missing } = await checkPrerequisites(userId, moduleId, { warningWindowDays })
    if (!met) flagged.set(moduleId, missing)
  }

  return flagged
}

/** Human-readable gap list for an error message. */
export function describeGaps(missing: PrerequisiteGap[]): string {
  return missing
    .map(gap => `${gap.moduleId} ${gap.name}${gap.state === 'EXPIRED' ? ' (expired)' : ''}`)
    .join(', ')
}
