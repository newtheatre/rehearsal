/**
 * Zod schemas for every request body and query (CLAUDE.md §repo-conventions).
 * Same style as Proscenium and stage-door.
 */

import { z } from 'zod'

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
 * `expiry_months` is required exactly when the mode is MONTHS — a module
 * configured MONTHS with no interval would stamp a nonsense expiry, and one
 * configured NONE with a leftover interval invites a misreading later.
 *
 * Written as a refinement function applied to each schema rather than a
 * wrapper helper: a helper taking `z.ZodType<T>` widens the schema and loses
 * Zod's inference, which quietly turns every parsed field optional.
 */
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

export type ModuleCreateInput = z.infer<typeof moduleCreateSchema>
export type ModuleUpdateInput = z.infer<typeof moduleUpdateSchema>
