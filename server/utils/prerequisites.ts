/**
 * Prerequisite evaluation.
 *
 * The same question — "does this person currently hold everything this module
 * requires?" — is asked in two places with two different consequences:
 *
 *   · certification sign-off  → HARD. Unmet means refused, server-side,
 *                               whatever the UI offered (CLAUDE.md invariant 5).
 *   · logging a session       → advisory. Trainers know why they are teaching
 *                               someone; the exception is safety-critical
 *                               modules, which block.
 *
 * Both count VALID and EXPIRING as held, per docs/records-and-expiry.md.
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

/** Direct prerequisites of a module (not transitive — see the note below). */
export async function prerequisiteIdsOf(moduleId: string): Promise<string[]> {
  const rows = await db.select({ id: schema.modulePrerequisites.requiresModuleId })
    .from(schema.modulePrerequisites)
    .where(eq(schema.modulePrerequisites.moduleId, moduleId))
    .all()
  return rows.map(r => r.id)
}

/**
 * Evaluate one person against one module's prerequisites.
 *
 * Deliberately direct prerequisites only, not the transitive closure: the
 * catalogue already chains them (a certification requires the modules, which
 * require the induction), and checking transitively would refuse a sign-off
 * over a lapsed induction two levels down without saying anything useful
 * about the skill being certified. If the committee wants the deeper rule it
 * is a policy change with an ADR, not a quiet default.
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

/** Human-readable gap list for an error message. */
export function describeGaps(missing: PrerequisiteGap[]): string {
  return missing
    .map(gap => `${gap.moduleId} ${gap.name}${gap.state === 'EXPIRED' ? ' (expired)' : ''}`)
    .join(', ')
}
