/**
 * The sweep's planner. Pure and clock-injected, which is what makes the
 * dry-run output testable. It plans notifications and nothing else.
 */

import { validityState } from './validity'

/**
 * A constant rather than config: the warning window is the operator's dial,
 * and a second knob invites the two being set inconsistently.
 */
export const FINAL_WARNING_DAYS = 14

export type NotificationType = 'expiry.window' | 'expiry.14day' | 'digest.monthly'

export interface SweepRecord {
  recordId: string
  userId: string
  moduleId: string
  moduleName: string
  department: string
  /** Non-null: records that never expire are filtered out before planning. */
  expiresAt: string
}

export interface SweepPerson {
  id: string
  email: string
  name: string
  isTrainingAdmin: boolean
}

export interface MemberWarning {
  userId: string
  email: string
  name: string
  type: 'expiry.window' | 'expiry.14day'
  records: SweepRecord[]
}

export interface Digest {
  userId: string
  email: string
  name: string
  /** null = every department (admins); otherwise the departments they lead. */
  departments: string[] | null
  expiring: SweepRecord[]
  expired: SweepRecord[]
}

export interface ExpiryPlan {
  warnings: MemberWarning[]
  digests: Digest[]
  counts: {
    recordsConsidered: number
    expiring: number
    expired: number
    windowWarnings: number
    finalWarnings: number
    digests: number
    /** Records whose person has no mirror row — cannot be emailed. */
    unaddressable: number
  }
}

export interface SweepInputs {
  /** ISO date the sweep is running for. */
  asOf: string
  warningWindowDays: number
  /** Current, non-revoked, non-brief records that carry an expiry. */
  records: SweepRecord[]
  people: SweepPerson[]
  leads: { department: string, userId: string }[]
  /** `${recordId}:${type}` for warnings already sent. */
  alreadyNotified: ReadonlySet<string>
  /** User ids that already received a digest this month. */
  digestSentThisMonth: ReadonlySet<string>
  /** Digests go out on the 1st. */
  isDigestDay: boolean
}

/** Whole days from `from` to `to`, both ISO dates. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  return Math.round((b - a) / 86_400_000)
}

export function planExpirySweep(input: SweepInputs): ExpiryPlan {
  const byId = new Map(input.people.map(p => [p.id, p]))

  const expiring: SweepRecord[] = []
  const expired: SweepRecord[] = []
  let unaddressable = 0

  // Grouped per (user, type) so a member gets one email covering everything,
  // not one per module.
  const warningGroups = new Map<string, MemberWarning>()

  for (const record of input.records) {
    const state = validityState(record.expiresAt, {
      asOf: input.asOf,
      warningWindowDays: input.warningWindowDays,
    })

    if (state === 'VALID') continue
    if (state === 'EXPIRED') {
      expired.push(record)
      continue
    }

    expiring.push(record)

    const person = byId.get(record.userId)
    if (!person) {
      unaddressable++
      continue
    }

    // The nearer deadline wins: once a record is inside the final window it
    // gets the urgent warning, never the gentler one it has outgrown.
    const daysLeft = daysBetween(input.asOf, record.expiresAt)
    const type: 'expiry.window' | 'expiry.14day'
      = daysLeft <= FINAL_WARNING_DAYS ? 'expiry.14day' : 'expiry.window'

    if (input.alreadyNotified.has(`${record.recordId}:${type}`)) continue

    const key = `${person.id}:${type}`
    const group = warningGroups.get(key) ?? {
      userId: person.id,
      email: person.email,
      name: person.name,
      type,
      records: [],
    }
    group.records.push(record)
    warningGroups.set(key, group)
  }

  const warnings = [...warningGroups.values()]
    .map(group => ({
      ...group,
      records: [...group.records].sort((a, b) => a.expiresAt.localeCompare(b.expiresAt)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type))

  const digests = input.isDigestDay
    ? planDigests(input, byId, expiring, expired)
    : []

  return {
    warnings,
    digests,
    counts: {
      recordsConsidered: input.records.length,
      expiring: expiring.length,
      expired: expired.length,
      windowWarnings: warnings.filter(w => w.type === 'expiry.window').length,
      finalWarnings: warnings.filter(w => w.type === 'expiry.14day').length,
      digests: digests.length,
      unaddressable,
    },
  }
}

/**
 * An empty digest is still sent. Its absence is the alert — a silent month
 * must mean nothing is expiring, not that the cron died.
 */
function planDigests(
  input: SweepInputs,
  byId: Map<string, SweepPerson>,
  expiring: SweepRecord[],
  expired: SweepRecord[],
): Digest[] {
  const departmentsByLead = new Map<string, string[]>()
  for (const lead of input.leads) {
    departmentsByLead.set(lead.userId, [...(departmentsByLead.get(lead.userId) ?? []), lead.department])
  }

  const recipients = new Map<string, string[] | null>()

  for (const [userId, departments] of departmentsByLead) {
    recipients.set(userId, departments)
  }
  // Admins see everything, and win over a narrower lead scope if they are both.
  for (const person of input.people) {
    if (person.isTrainingAdmin) recipients.set(person.id, null)
  }

  const digests: Digest[] = []

  for (const [userId, departments] of recipients) {
    if (input.digestSentThisMonth.has(userId)) continue

    const person = byId.get(userId)
    if (!person) continue

    const inScope = (record: SweepRecord) =>
      departments === null || departments.includes(record.department)

    digests.push({
      userId: person.id,
      email: person.email,
      name: person.name,
      departments,
      expiring: expiring.filter(inScope).sort((a, b) => a.expiresAt.localeCompare(b.expiresAt)),
      expired: expired.filter(inScope).sort((a, b) => b.expiresAt.localeCompare(a.expiresAt)),
    })
  }

  return digests.sort((a, b) => a.name.localeCompare(b.name))
}

/** Is this the day the monthly digest goes out? */
export function isDigestDay(asOf: string): boolean {
  return asOf.endsWith('-01')
}
