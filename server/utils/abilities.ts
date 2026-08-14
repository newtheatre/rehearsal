/**
 * The ability layer — docs/permissions.md.
 *
 * Three independent sources of authority, deliberately not collapsed into
 * one role list:
 *
 *   1. `training:ADMIN`  — the only auth-service role this app uses (TM + ITM)
 *   2. department leads  — app data, swapped at handover (ADR-0005)
 *   3. trainer standing  — DERIVED from a valid grants_trainer record,
 *                          re-read every request, never cached (ADR-0004)
 *
 * Everything here is evaluated server-side. The UI reflecting an ability is
 * a courtesy, never the check.
 */

import { db, schema } from '@nuxthub/db'
import { and, eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import type { User } from '#auth-utils'
import { heldRecordCondition } from './validity'

export const ROLE_NAMESPACE = 'training'

export interface Abilities {
  user: User
  /** training:ADMIN — Theatre Manager and ITM. */
  isAdmin: boolean
  /** Department codes this user leads (empty for most people). */
  leadOf: string[]
  /** Holds a currently-valid certification with grants_trainer (LEAD-CERT). */
  isTrainer: boolean
}

/** Department codes the user leads. */
export async function leadDepartments(userId: string): Promise<string[]> {
  const rows = await db.select({ department: schema.departmentLeads.department })
    .from(schema.departmentLeads)
    .where(eq(schema.departmentLeads.userId, userId))
    .all()
  return rows.map(r => r.department)
}

/**
 * Trainer standing is a training outcome, not a role: the trainer list is
 * definitionally the list of people holding a valid Trainer certification.
 * Expiry of the cert removes the ability with no admin action (ADR-0004).
 */
export async function holdsTrainerCertification(userId: string): Promise<boolean> {
  const row = await db.select({ id: schema.records.id })
    .from(schema.records)
    .innerJoin(schema.modules, eq(schema.records.moduleId, schema.modules.id))
    .where(and(
      eq(schema.records.userId, userId),
      eq(schema.modules.grantsTrainer, true),
      heldRecordCondition(),
    ))
    .get()
  return Boolean(row)
}

/** Resolve every ability for this request, once. */
export async function getAbilities(user: User): Promise<Abilities> {
  const isAdmin = hasRole(user, ROLE_NAMESPACE, 'ADMIN')
  const [leadOf, trainerCert] = await Promise.all([
    leadDepartments(user.id),
    holdsTrainerCertification(user.id),
  ])
  return { user, isAdmin, leadOf, isTrainer: isAdmin || trainerCert }
}

/** May this user see DRAFT modules and admin-only notes? */
export function canSeeDrafts(abilities: Abilities): boolean {
  return abilities.isAdmin || abilities.leadOf.length > 0
}

/** May this user create/edit modules in this department? */
export function canStewardDepartment(abilities: Abilities, department: string): boolean {
  return abilities.isAdmin || abilities.leadOf.includes(department)
}

/**
 * Cached per request so a handler and its helpers don't re-query.
 * `event.context.user` is set by the global middleware.
 */
export async function useAbilities(event: H3Event): Promise<Abilities> {
  const cached = event.context.abilities as Abilities | undefined
  if (cached) return cached

  const user = event.context.user as User | undefined
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const abilities = await getAbilities(user)
  event.context.abilities = abilities
  return abilities
}
