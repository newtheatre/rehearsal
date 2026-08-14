/**
 * Catalogue mutations — the rules that must hold however a module is edited.
 *
 * Kept out of the handlers so create and update cannot drift apart, and so
 * the invariants below are enforced once: kind/flag consistency, prerequisite
 * resolution, and no prerequisite cycles.
 */

import { db, schema } from '@nuxthub/db'
import { eq, inArray } from 'drizzle-orm'

type Kind = 'MODULE' | 'CERTIFICATION' | 'BRIEF'

/**
 * Kind decides three flags, so they can never be set into a contradictory
 * state (ADR-0003): only certifications are signed off, and briefs — which
 * recur per event and gate nothing — confer no standing at all.
 */
export function applyKindRules<T extends { kind: Kind, grantsSupervisor?: boolean, grantsTrainer?: boolean }>(input: T) {
  const isCertification = input.kind === 'CERTIFICATION'
  const isBrief = input.kind === 'BRIEF'
  return {
    ...input,
    signoffRequired: isCertification,
    grantsSupervisor: isCertification && Boolean(input.grantsSupervisor),
    grantsTrainer: isCertification && Boolean(input.grantsTrainer),
    // Briefs never expire and never gate — the machinery must not be used to
    // model something that recurs weekly.
    ...(isBrief ? { expiryMode: 'NONE' as const, expiryMonths: null } : {}),
  }
}

/** Every prerequisite must exist. Unknown ids are a 400, not a dangling FK. */
export async function assertPrerequisitesExist(moduleId: string, prerequisites: string[]): Promise<void> {
  if (prerequisites.length === 0) return

  if (prerequisites.includes(moduleId)) {
    throw createError({ statusCode: 400, statusMessage: 'A module cannot be its own prerequisite' })
  }

  const found = await db.select({ id: schema.modules.id })
    .from(schema.modules)
    .where(inArray(schema.modules.id, prerequisites)).all()

  const missing = prerequisites.filter(id => !found.some(row => row.id === id))
  if (missing.length > 0) {
    throw createError({
      statusCode: 400,
      statusMessage: `Unknown prerequisite${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`,
    })
  }
}

/**
 * Reject prerequisite cycles. Sign-off only walks direct prerequisites, so a
 * cycle wouldn't hang anything — but a catalogue where A requires B requires A
 * is unsatisfiable, and quietly storing one turns a content mistake into a
 * member who can never be signed off.
 */
export async function assertNoPrerequisiteCycle(moduleId: string, prerequisites: string[]): Promise<void> {
  if (prerequisites.length === 0) return

  const edges = await db.select().from(schema.modulePrerequisites).all()
  const graph = new Map<string, string[]>()
  for (const edge of edges) {
    if (edge.moduleId === moduleId) continue // proposed set replaces these
    graph.set(edge.moduleId, [...(graph.get(edge.moduleId) ?? []), edge.requiresModuleId])
  }
  graph.set(moduleId, prerequisites)

  const seen = new Set<string>()
  const stack: string[] = [...prerequisites]
  while (stack.length > 0) {
    const current = stack.pop()!
    if (current === moduleId) {
      throw createError({
        statusCode: 400,
        statusMessage: `Prerequisite cycle: ${moduleId} would end up requiring itself`,
      })
    }
    if (seen.has(current)) continue
    seen.add(current)
    stack.push(...(graph.get(current) ?? []))
  }
}

/** Replace a module's prerequisite set (an edit that removes one must remove it). */
export async function replacePrerequisites(moduleId: string, prerequisites: string[]): Promise<void> {
  await db.delete(schema.modulePrerequisites)
    .where(eq(schema.modulePrerequisites.moduleId, moduleId))

  for (const requiresModuleId of prerequisites) {
    await db.insert(schema.modulePrerequisites).values({ moduleId, requiresModuleId })
  }
}

/**
 * For ordinary modules the id IS the department (`DEPT-LCT`), so a module
 * whose id and department disagree is a nonsense catalogue entry — the id
 * members quote would name a department the module isn't in.
 *
 * Certifications are exempt: `LD-CERT` legitimately sits in TECH, which is
 * why they carry their department separately. Same rule the CSV importer
 * applies, enforced here too so the two paths can't disagree.
 */
export function assertIdMatchesDepartment(id: string, department: string): void {
  if (id.endsWith('-CERT')) return
  if (!id.startsWith(`${department}-`)) {
    throw createError({
      statusCode: 400,
      statusMessage: `Module ${id} belongs in department ${id.split('-')[0]}, not ${department}`,
    })
  }
}

/** The department must exist — the FK would say so, but not in English. */
export async function assertDepartmentExists(code: string): Promise<void> {
  const department = await db.select({ code: schema.departments.code })
    .from(schema.departments).where(eq(schema.departments.code, code)).get()
  if (!department) {
    throw createError({ statusCode: 400, statusMessage: `Unknown department "${code}"` })
  }
}
