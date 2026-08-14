/**
 * PUT /api/admin/eligibility-rules — create or update a rule.
 *
 * Powerful and quiet: changing what `duty-manager` requires changes who may
 * claim a shift in another app, with no deploy anywhere. That is the point
 * (ADR-0006), and the mitigations are that every change is audit-logged and
 * the runbook says to tell the consuming app's owner.
 *
 * Keys are never renamed. A consumer hardcodes the key, so renaming one
 * breaks it with a 404 — create the new rule and retire the old one instead.
 */

import { db, schema } from '@nuxthub/db'
import { eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { requireAdmin } from '../../../utils/auth'
import { requiresSchema, parseRequires } from '../../../utils/eligibility'
import { writeAudit } from '../../../utils/audit'

const bodySchema = z.object({
  key: z.string().trim().toLowerCase().min(2).max(40)
    .regex(/^[a-z0-9-]+$/, 'Lowercase letters, numbers and hyphens'),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).nullable().optional(),
  requires: requiresSchema,
})

export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const input = await readValidatedBody(event, bodySchema.parse)

  const referenced = [...new Set([...input.requires.allOf, ...input.requires.anyOf])]
  if (referenced.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A rule with no requirements would make everyone eligible — say what it needs',
    })
  }

  const found = await db.select({ id: schema.modules.id, kind: schema.modules.kind })
    .from(schema.modules).where(inArray(schema.modules.id, referenced)).all()

  const missing = referenced.filter(id => !found.some(m => m.id === id))
  if (missing.length > 0) {
    throw createError({
      statusCode: 400,
      statusMessage: `Unknown module${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`,
    })
  }

  // Briefs never gate anything, so one in a rule would silently never be
  // satisfied — refuse rather than create an unsatisfiable rule.
  const briefs = found.filter(m => m.kind === 'BRIEF')
  if (briefs.length > 0) {
    throw createError({
      statusCode: 400,
      statusMessage: `Briefs never count towards eligibility: ${briefs.map(b => b.id).join(', ')}`,
    })
  }

  const existing = await db.select().from(schema.eligibilityRules)
    .where(eq(schema.eligibilityRules.key, input.key)).get()

  const values = {
    key: input.key,
    name: input.name,
    description: input.description ?? null,
    requires: JSON.stringify(input.requires),
    updatedBy: admin.id,
  }

  await db.insert(schema.eligibilityRules).values(values)
    .onConflictDoUpdate({
      target: schema.eligibilityRules.key,
      set: { ...values, updatedAt: new Date() },
    })

  await writeAudit({
    actorUserId: admin.id,
    action: existing ? 'eligibility-rule.update' : 'eligibility-rule.create',
    target: input.key,
    detail: {
      from: existing ? parseRequires(existing.requires) : null,
      to: input.requires,
    },
  })

  return { key: input.key, requires: input.requires, created: !existing }
})
