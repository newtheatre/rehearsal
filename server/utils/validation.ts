/**
 * Zod schemas for every request body and query (CLAUDE.md §repo-conventions).
 * Same style as Proscenium and stage-door.
 */

import { z } from 'zod'
import { addMonths } from './expiry'
import { today } from '../../shared/utils/dates'

/** `TECH-111` (DEPT-LCT) or `LD-CERT`. Matches the catalogue parser. */
export const moduleIdSchema = z.string().trim().toUpperCase()
  .regex(/^[A-Z]{2,4}-([0-9]{3}|CERT)$/, 'Not a valid module id (e.g. TECH-111 or LD-CERT)')

export const departmentCodeSchema = z.string().trim().toUpperCase()
  .regex(/^[A-Z]{3,4}$/, 'Not a valid department code')

/** Drive links only in practice; we validate the scheme and nothing more. */
export const materialsUrlSchema = z.string().trim().url()
  .refine(value => value.startsWith('https://'), 'Materials links must be https://')

const expiryFields = {
  expiryMode: z.enum(['NONE', 'MONTHS', 'ACADEMIC_YEAR']),
  expiryMonths: z.number().int().positive().max(120).nullable().optional(),
}

/**
 * `expiry_months` is required exactly when the mode is MONTHS. A refinement
 * rather than a wrapper: a wrapper widens the schema and loses inference.
 */
/**
 * The same rule as checkExpiry, applied to the row a partial update would
 * leave behind rather than to the fields it submitted.
 */
export function assertExpiryConsistent(mode: string, months: number | null | undefined): void {
  if (mode === 'MONTHS' && !months) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A months-based expiry needs a number of months',
    })
  }
  if (mode !== 'MONTHS' && months) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Only a months-based expiry may set a number of months',
    })
  }
}

function checkExpiry(
  value: { expiryMode?: string, expiryMonths?: number | null },
  ctx: z.RefinementCtx,
): void {
  if (value.expiryMode === 'MONTHS' && !value.expiryMonths) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['expiryMonths'],
      message: 'A months-based expiry needs a number of months',
    })
  }
  if (value.expiryMode && value.expiryMode !== 'MONTHS' && value.expiryMonths) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['expiryMonths'],
      message: 'Only a months-based expiry may set a number of months',
    })
  }
}

export const moduleCreateSchema = z.object({
  id: moduleIdSchema,
  department: departmentCodeSchema,
  kind: z.enum(['MODULE', 'CERTIFICATION', 'BRIEF']).default('MODULE'),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(4000).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  materialsUrl: materialsUrlSchema.nullable().optional(),
  ...expiryFields,
  safetyCritical: z.boolean().default(false),
  allowsExternal: z.boolean().default(false),
  externalEvidence: z.string().trim().max(500).nullable().optional(),
  grantsSupervisor: z.boolean().default(false),
  grantsTrainer: z.boolean().default(false),
  status: z.enum(['DRAFT', 'ACTIVE', 'RETIRED']).default('DRAFT'),
  sort: z.number().int().min(0).max(9999).default(0),
  prerequisites: z.array(moduleIdSchema).max(20).default([]),
}).superRefine(checkExpiry)

export const moduleUpdateSchema = z.object({
  department: departmentCodeSchema.optional(),
  kind: z.enum(['MODULE', 'CERTIFICATION', 'BRIEF']).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  materialsUrl: materialsUrlSchema.nullable().optional(),
  expiryMode: expiryFields.expiryMode.optional(),
  expiryMonths: expiryFields.expiryMonths,
  safetyCritical: z.boolean().optional(),
  allowsExternal: z.boolean().optional(),
  externalEvidence: z.string().trim().max(500).nullable().optional(),
  grantsSupervisor: z.boolean().optional(),
  grantsTrainer: z.boolean().optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'RETIRED']).optional(),
  sort: z.number().int().min(0).max(9999).optional(),
  prerequisites: z.array(moduleIdSchema).max(20).optional(),
}).superRefine(checkExpiry)

export const moduleListQuerySchema = z.object({
  department: departmentCodeSchema.optional(),
  status: z.enum(['ACTIVE', 'DRAFT', 'RETIRED', 'all']).optional(),
  kind: z.enum(['MODULE', 'CERTIFICATION', 'BRIEF']).optional(),
  q: z.string().trim().max(100).optional(),
})

// ── Records and sessions ────────────────────────────────────────────────────

/** ISO calendar date. Stored as text so string comparison is date comparison. */
export const isoDateSchema = z.string().trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date in YYYY-MM-DD form')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`)
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
  }, 'Not a real date')

/**
 * `awarded_at` may be backdated but never postdated: a record for training
 * that has not happened would be valid to every gate in the system.
 */
export const awardedAtSchema = isoDateSchema.refine(
  value => value <= today(),
  'Training cannot be recorded for a future date',
)

export const sessionInputSchema = z.object({
  heldOn: awardedAtSchema,
  moduleIds: z.array(moduleIdSchema).min(1, 'A session must cover at least one module').max(20),
  attendeeIds: z.array(z.string().trim().min(1)).max(100).default([]),
  location: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  /** Set once the trainer has seen and accepted the prerequisite warnings. */
  acknowledgeWarnings: z.boolean().default(false),
})

// ── Scheduling ──────────────────────────────────────────────────────────────

/** The largest capacity a lead may set. A session may still exceed it via the
 * waitlist and walk-ins, which is what MAX_REGISTER bounds. */
export const MAX_SESSION_CAPACITY = 60

/**
 * Submitting a register writes one statement per attendee per module in one
 * batch, so the register itself is bounded (docs/scheduling-design.md §5.3).
 */
export const MAX_REGISTER = 200

/** A timestamp on the wire. Stored as epoch ms, so this is the parse point. */
const timestampSchema = z.coerce.date()

/**
 * `heldOn` is deliberately not awardedAtSchema: a scheduled session is in the
 * future, which is exactly what that schema refuses.
 */
export const sessionScheduleSchema = z.object({
  heldOn: isoDateSchema,
  moduleIds: z.array(moduleIdSchema).min(1, 'A session must cover at least one module').max(20),
  startsAt: timestampSchema.nullable().optional(),
  endsAt: timestampSchema.nullable().optional(),
  signupsCloseAt: timestampSchema.nullable().optional(),
  capacity: z.number().int().min(1).max(MAX_SESSION_CAPACITY).nullable().optional(),
  location: z.string().trim().max(120).nullable().optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  /** Skip PLANNED and put it in front of members straight away. */
  openNow: z.boolean().default(false),
}).superRefine(checkSchedule)

export const sessionScheduleUpdateSchema = z.object({
  heldOn: isoDateSchema.optional(),
  moduleIds: z.array(moduleIdSchema).min(1).max(20).optional(),
  startsAt: timestampSchema.nullable().optional(),
  endsAt: timestampSchema.nullable().optional(),
  signupsCloseAt: timestampSchema.nullable().optional(),
  capacity: z.number().int().min(1).max(MAX_SESSION_CAPACITY).nullable().optional(),
  location: z.string().trim().max(120).nullable().optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
}).superRefine(checkSchedule)

export const moduleRequestSchema = z.object({
  moduleId: moduleIdSchema,
  note: z.string().trim().max(500).nullable().optional(),
})

export const declineRequestSchema = z.object({
  // The requester is shown this, so it is a reply rather than a rejection.
  reason: z.string().trim().min(3, 'Say why: the person who asked is shown it').max(500),
})

export const practiceTargetSchema = z.object({
  key: z.string().trim().toLowerCase()
    .regex(/^[a-z][a-z0-9-]{1,40}$/, 'Use a lower-case key like bar-till'),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  consumer: z.string().trim().max(60).nullable().optional(),
  moduleIds: z.array(moduleIdSchema).max(40).default([]),
  graceHours: z.number().int().min(0).max(48).nullable().optional(),
  status: z.enum(['ACTIVE', 'RETIRED']).default('ACTIVE'),
})

export const grantPracticeSchema = z.object({
  userId: z.string().trim().min(1),
  targetKey: z.string().trim().min(1).max(40),
  hours: z.number().int().min(1).max(24).default(4),
  reason: z.string().trim().min(3, 'Say why: an ad-hoc sandbox is a deliberate act').max(500),
})

export const registerSchema = z.object({
  marks: z.array(z.object({
    userId: z.string().trim().min(1),
    present: z.boolean(),
  })).min(1, 'Mark at least one person').max(MAX_REGISTER),
  /** Set once the trainer has seen and accepted the prerequisite warnings. */
  acknowledgeWarnings: z.boolean().default(false),
})

export const addAttendeeSchema = z.object({
  userId: z.string().trim().min(1),
})

export const cancelSessionSchema = z.object({
  // Everyone signed up is told this, so it is not optional.
  reason: z.string().trim().min(3, 'Give a reason: everyone signed up will be told it').max(500),
})

function checkSchedule(
  value: { startsAt?: Date | null, endsAt?: Date | null },
  ctx: z.RefinementCtx,
): void {
  if (value.startsAt && value.endsAt && value.endsAt <= value.startsAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endsAt'],
      message: 'A session cannot end before it starts',
    })
  }
}

/** An expiry not after the award, or a decade out, is a typo not a policy. */
export function assertExpiryPlausible(awardedAt: string, expiresAt: string, message: string): void {
  if (expiresAt <= awardedAt) {
    throw createError({ statusCode: 400, statusMessage: message })
  }
  // 120 months is the catalogue's own cap, so an override cannot express a
  // policy a module is not allowed to have.
  if (expiresAt > addMonths(awardedAt, 120)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'That expiry is more than ten years away: check the date',
    })
  }
}

export const signoffSchema = z.object({
  moduleId: moduleIdSchema,
  awardedAt: awardedAtSchema,
  /** Only when the assessment itself carries a date; policy applies otherwise. */
  expiresAt: isoDateSchema.optional(),
  /** Admin only, and deliberately absent from the UI (ADR-0012). */
  neverExpires: z.boolean().optional(),
  note: z.string().trim().max(500).nullable().optional(),
})

export const externalRecordSchema = z.object({
  moduleId: moduleIdSchema,
  awardedAt: awardedAtSchema,
  /** The certificate's own expiry: always wins over module config. */
  expiresAt: isoDateSchema.nullable().optional(),
  externalRef: z.string().trim().min(1, 'Record what the certificate is').max(200),
})

export const revokeSchema = z.object({
  // Mandatory: a revocation without a reason is indistinguishable from a
  // mistake, and the reason is what makes history reviewable (ADR-0008).
  reason: z.string().trim().min(3, 'Give a reason, it stays in the record').max(500),
})

export const attendeeLookupSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(1).max(120).optional(),
})
