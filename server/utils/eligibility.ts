/**
 * Eligibility rules: named questions other apps ask (ADR-0006). This app
 * answers; it never knows what the answer is for.
 */

import { db, schema } from '@nuxthub/db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { countsAsValid } from './validity'
import { currentRecordsForModules } from './records'
import { moduleIdSchema } from './validation'

export const requiresSchema = z.object({
  allOf: z.array(moduleIdSchema).max(20).default([]),
  anyOf: z.array(moduleIdSchema).max(20).default([]),
})

export type Requires = z.infer<typeof requiresSchema>

export interface EligibilityAnswer {
  eligible: boolean
  /** Required modules the person doesn't currently hold. */
  missing: string[]
  /** Held, but inside the warning window: actionable UX for the consumer. */
  expiring: { moduleId: string, expiresAt: string }[]
}

/** A stored rule nothing can read. Never answered around (ADR-0010). */
export class UnreadableRuleError extends Error {}

/**
 * Parse a stored `requires` blob. A rule requiring nothing is corrupt, not
 * permissive: the write path refuses to create one.
 */
export function parseRequires(raw: string): Requires {
  let parsed: Requires
  try {
    parsed = requiresSchema.parse(JSON.parse(raw))
  }
  catch {
    throw new UnreadableRuleError('the stored rule is not readable')
  }

  if (parsed.allOf.length === 0 && parsed.anyOf.length === 0) {
    throw new UnreadableRuleError('the stored rule requires nothing')
  }
  return parsed
}

/** For listings, which must show a corrupt rule rather than fail on it. */
export function tryParseRequires(raw: string): Requires | null {
  try {
    return parseRequires(raw)
  }
  catch {
    return null
  }
}

/**
 * `anyOf` only constrains when non-empty: an empty one means an all-of rule,
 * not an unsatisfiable one.
 */
export async function evaluateRule(
  requires: Requires,
  userId: string,
  { warningWindowDays = 60 }: { warningWindowDays?: number } = {},
): Promise<EligibilityAnswer> {
  if (requires.allOf.length === 0 && requires.anyOf.length === 0) {
    throw new UnreadableRuleError('the stored rule requires nothing')
  }

  const moduleIds = [...new Set([...requires.allOf, ...requires.anyOf])]
  const held = await currentRecordsForModules(userId, moduleIds, { warningWindowDays })

  const holds = (moduleId: string) => {
    const record = held.get(moduleId)
    if (!record) return false
    // Briefs have no state and gate nothing; they should never appear in a
    // rule, but if one does it must not silently satisfy it.
    return record.state !== null && countsAsValid(record.state)
  }

  const missing = requires.allOf.filter(id => !holds(id))
  const anyOfSatisfied = requires.anyOf.length === 0 || requires.anyOf.some(holds)

  if (!anyOfSatisfied) {
    // Report the whole anyOf set: any one of them would do, so naming one
    // would misrepresent the choice.
    missing.push(...requires.anyOf.filter(id => !holds(id)))
  }

  const expiring = moduleIds
    .filter(id => held.get(id)?.state === 'EXPIRING')
    .map(id => ({ moduleId: id, expiresAt: held.get(id)!.expiresAt! }))

  return {
    eligible: missing.length === 0 && anyOfSatisfied,
    missing: [...new Set(missing)],
    expiring,
  }
}

/** Load a rule by key, or null. */
export async function loadRule(key: string) {
  const row = await db.select().from(schema.eligibilityRules)
    .where(eq(schema.eligibilityRules.key, key)).get()
  return row ?? null
}

/**
 * Evaluated per person rather than as one clever query: the membership is
 * tens of people, and one implementation of the semantics is worth more.
 */
export async function eligibleUserIds(
  requires: Requires,
  { warningWindowDays = 60 }: { warningWindowDays?: number } = {},
): Promise<string[]> {
  const users = await db.select({ id: schema.users.id }).from(schema.users).all()

  const results = await Promise.all(users.map(async (user) => {
    const answer = await evaluateRule(requires, user.id, { warningWindowDays })
    return answer.eligible ? user.id : null
  }))

  return results.filter((id): id is string => id !== null)
}
