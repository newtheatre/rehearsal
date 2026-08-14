/**
 * Eligibility rules: named questions other apps ask about a person's training
 * (ADR-0006).
 *
 * A rule is data — `allOf` and `anyOf` lists of module ids, edited in the
 * admin UI. This app answers the question; it never knows what the answer is
 * *for*. The rota decides what "not eligible to duty-manage" means in its own
 * UX; we only say whether the training is there.
 *
 * VALID and EXPIRING both count as held, exactly as everywhere else
 * (docs/records-and-expiry.md).
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
  /** Held, but inside the warning window — actionable UX for the consumer. */
  expiring: { moduleId: string, expiresAt: string }[]
}

/** Parse a stored `requires` blob, tolerating an empty or legacy value. */
export function parseRequires(raw: string): Requires {
  try {
    return requiresSchema.parse(JSON.parse(raw))
  }
  catch {
    return { allOf: [], anyOf: [] }
  }
}

/**
 * Evaluate one person against one rule.
 *
 * `anyOf` only constrains when it is non-empty: a rule with an empty `anyOf`
 * is an all-of rule, not an unsatisfiable one.
 */
export async function evaluateRule(
  requires: Requires,
  userId: string,
  { warningWindowDays = 60 }: { warningWindowDays?: number } = {},
): Promise<EligibilityAnswer> {
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
 * Everyone who currently satisfies a rule.
 *
 * Evaluated per person rather than as one clever query: the membership is
 * tens of people, and one implementation of the rule semantics is worth more
 * than the round trips saved.
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
