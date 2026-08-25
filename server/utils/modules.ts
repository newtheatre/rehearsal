/**
 * Catalogue reads, with draft visibility applied in one place so a new screen
 * cannot leak half-written safety content by forgetting a filter.
 */

import { db, schema } from '@nuxthub/db'
import { and, asc, eq, like, or, ne, type SQL } from 'drizzle-orm'
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core'
import type { Abilities } from './abilities'
import { canSeeDrafts } from './abilities'

export type ModuleRow = typeof schema.modules.$inferSelect

export interface ModuleListFilters {
  department?: string
  status?: 'ACTIVE' | 'DRAFT' | 'RETIRED' | 'all'
  kind?: 'MODULE' | 'CERTIFICATION' | 'BRIEF'
  q?: string
}

/**
 * Retired modules stay visible to everyone: a member whose record points at
 * one still needs to read it, but are never offerable.
 */
function visibleStatusCondition(abilities: Abilities): SQL | undefined {
  return canSeeDrafts(abilities) ? undefined : ne(schema.modules.status, 'DRAFT')
}

export async function listModules(abilities: Abilities, filters: ModuleListFilters = {}) {
  const conditions: (SQL | undefined)[] = [visibleStatusCondition(abilities)]

  if (filters.department) conditions.push(eq(schema.modules.department, filters.department))
  if (filters.kind) conditions.push(eq(schema.modules.kind, filters.kind))
  if (filters.status && filters.status !== 'all') {
    // A non-privileged caller asking for DRAFT gets an empty list, not drafts.
    conditions.push(eq(schema.modules.status, filters.status))
  }
  if (filters.q) {
    const pattern = `%${filters.q.toLowerCase()}%`
    conditions.push(or(
      like(schema.modules.id, pattern.toUpperCase()),
      like(schema.modules.name, pattern),
    ))
  }

  const rows = await db.select().from(schema.modules)
    .where(and(...conditions.filter(Boolean) as SQL[]))
    .all()

  return rows
    .map(row => presentModule(row, abilities))
    .sort((a, b) => a.department.localeCompare(b.department) || a.sort - b.sort || a.id.localeCompare(b.id))
}

/** Module detail with prerequisites and the modules that depend on it. */
export async function getModuleDetail(id: string, abilities: Abilities) {
  const module = await db.select().from(schema.modules)
    .where(eq(schema.modules.id, id)).get()

  if (!module) return null
  if (module.status === 'DRAFT' && !canSeeDrafts(abilities)) return null

  const [prerequisites, requiredBy] = await Promise.all([
    relatedModules(schema.modulePrerequisites.requiresModuleId, eq(schema.modulePrerequisites.moduleId, id)),
    relatedModules(schema.modulePrerequisites.moduleId, eq(schema.modulePrerequisites.requiresModuleId, id)),
  ])

  return {
    ...presentModule(module, abilities),
    prerequisites: visibleRelated(prerequisites, abilities),
    requiredBy: visibleRelated(requiredBy, abilities),
  }
}

/**
 * Joined, never an IN list of the ids just read: a module's dependents are
 * bounded only by the catalogue, and D1 caps a statement at 100 parameters.
 */
function relatedModules(joinColumn: SQLiteColumn, match: SQL) {
  return db.select({
    id: schema.modules.id,
    name: schema.modules.name,
    kind: schema.modules.kind,
    status: schema.modules.status,
    department: schema.modules.department,
  })
    .from(schema.modulePrerequisites)
    .innerJoin(schema.modules, eq(schema.modules.id, joinColumn))
    .where(match)
    .orderBy(asc(schema.modules.department), asc(schema.modules.sort), asc(schema.modules.id))
    .all()
}

// A draft prerequisite is hidden from members like any other draft, but the
// dependency itself is still enforced server-side at sign-off.
function visibleRelated<T extends { status: ModuleRow['status'] }>(rows: T[], abilities: Abilities): T[] {
  return rows.filter(row => row.status !== 'DRAFT' || canSeeDrafts(abilities))
}

/**
 * Strip fields the caller may not see. `notes` are the subcommittee's working
 * notes and are lead/admin-only.
 */
export function presentModule(module: ModuleRow, abilities: Abilities) {
  const { notes, ...rest } = module
  return {
    ...rest,
    notes: canSeeDrafts(abilities) ? notes : null,
  }
}
