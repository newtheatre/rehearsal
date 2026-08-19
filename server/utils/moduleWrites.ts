/**
 * Catalogue mutations, kept out of the handlers so create and update cannot
 * drift: kind/flag consistency, prerequisite resolution, cycle checks.
 */

import { db, schema } from '@nuxthub/db'
import { eq, inArray } from 'drizzle-orm'
import { runAtomic } from './batch'

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
 * Reject prerequisite cycles: A requires B requires A is unsatisfiable, and
 * storing one turns a content mistake into a member who can never sign off.
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
  // Atomic: a delete that lands without its inserts strips the module's
  // sign-off gate silently (ADR-0009).
  await runAtomic([
    db.delete(schema.modulePrerequisites)
      .where(eq(schema.modulePrerequisites.moduleId, moduleId)),
    ...prerequisites.map(requiresModuleId =>
      db.insert(schema.modulePrerequisites).values({ moduleId, requiresModuleId }),
    ),
  ])
}

/**
 * An ordinary module's id IS its department, so a mismatch is nonsense.
 * Certifications are exempt: same rule the CSV importer applies.
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

/** The department must exist: the FK would say so, but not in English. */
export async function assertDepartmentExists(code: string): Promise<void> {
  const department = await db.select({ code: schema.departments.code })
    .from(schema.departments).where(eq(schema.departments.code, code)).get()
  if (!department) {
    throw createError({ statusCode: 400, statusMessage: `Unknown department "${code}"` })
  }
}
