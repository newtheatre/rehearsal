/**
 * Zod schemas for every request body and query (CLAUDE.md §repo-conventions).
 * Same style as Proscenium and stage-door.
 */

import { z } from 'zod'
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
 * `awarded_at` may be backdated but never postdated — a record for training
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

export const signoffSchema = z.object({
  moduleId: moduleIdSchema,
  awardedAt: awardedAtSchema,
  note: z.string().trim().max(500).nullable().optional(),
})

export const externalRecordSchema = z.object({
  moduleId: moduleIdSchema,
  awardedAt: awardedAtSchema,
  /** The certificate's own expiry — always wins over module config. */
  expiresAt: isoDateSchema.nullable().optional(),
  externalRef: z.string().trim().min(1, 'Record what the certificate is').max(200),
})

export const revokeSchema = z.object({
  // Mandatory: a revocation without a reason is indistinguishable from a
  // mistake, and the reason is what makes history reviewable (ADR-0008).
  reason: z.string().trim().min(3, 'Give a reason — it stays in the record').max(500),
})

export const attendeeLookupSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(1).max(120).optional(),
})
