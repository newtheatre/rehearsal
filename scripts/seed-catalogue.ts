/**
 * Catalogue import: `data/catalogue.csv` → departments, modules,
 * prerequisites and the legacy code map (docs/migration.md §1).
 *
 * The same parser backs the dev seed, so fixtures can't drift from the real
 * import path. Unparseable cells are hard failures naming the cell.
 *
 *   bun run seed:catalogue [path/to/catalogue.csv]
 *
 * Re-running is idempotent and treats the CSV as the source of truth for the
 * fields it carries: catalogue rows are overwritten. Once the catalogue is
 * live, ordinary content edits belong in the admin UI, not here.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { inArray } from 'drizzle-orm'
import { parseCatalogue } from './lib/catalogue'
import { openLocalDb, schema } from './lib/localDb'

// Structural, not content: the nine departments are the DEPT half of the
// subcommittee's id scheme.
const DEPARTMENTS = [
  { code: 'NNT', name: 'All-member', sort: 1 },
  { code: 'SFTY', name: 'Safety', sort: 2 },
  { code: 'TECH', name: 'Technical', sort: 3 },
  { code: 'STGE', name: 'Stage Management', sort: 4 },
  { code: 'MGMT', name: 'Management', sort: 5 },
  { code: 'COST', name: 'Costume', sort: 6 },
  { code: 'PROD', name: 'Producing', sort: 7 },
  { code: 'ADMN', name: 'Administration', sort: 8 },
  { code: 'LEAD', name: 'Leadership & Training', sort: 9 },
]

export async function seedCatalogue(csvPath: string, db: ReturnType<typeof openLocalDb>) {
  const text = readFileSync(csvPath, 'utf8')
  const modules = parseCatalogue(text, csvPath)

  for (const department of DEPARTMENTS) {
    await db.insert(schema.departments).values(department)
      .onConflictDoUpdate({
        target: schema.departments.code,
        set: { name: department.name, sort: department.sort },
      })
  }

  const knownDepartments = new Set(DEPARTMENTS.map(d => d.code))
  for (const module of modules) {
    if (!knownDepartments.has(module.department)) {
      throw new Error(`${csvPath}: ${module.id} names unknown department "${module.department}"`)
    }
  }

  // Modules first, so prerequisites can reference any of them.
  for (const module of modules) {
    const values = {
      id: module.id,
      department: module.department,
      kind: module.kind,
      name: module.name,
      description: module.description,
      notes: module.notes,
      materialsUrl: module.materialsUrl,
      expiryMode: module.expiryMode,
      expiryMonths: module.expiryMonths,
      safetyCritical: module.safetyCritical,
      signoffRequired: module.signoffRequired,
      grantsSupervisor: module.grantsSupervisor,
      grantsTrainer: module.grantsTrainer,
      status: module.status,
      sort: module.sort,
    }
    await db.insert(schema.modules).values(values)
      .onConflictDoUpdate({ target: schema.modules.id, set: { ...values, updatedAt: new Date() } })
  }

  const ids = modules.map(m => m.id)
  // Replace wholesale for the modules in this file: an edit that REMOVES a
  // prerequisite must actually remove it.
  await db.delete(schema.modulePrerequisites).where(inArray(schema.modulePrerequisites.moduleId, ids))
  await db.delete(schema.legacyModuleMap).where(inArray(schema.legacyModuleMap.moduleId, ids))

  let prerequisiteCount = 0
  let legacyCount = 0
  for (const module of modules) {
    for (const requires of module.prerequisites) {
      await db.insert(schema.modulePrerequisites)
        .values({ moduleId: module.id, requiresModuleId: requires })
      prerequisiteCount++
    }
    for (const legacyCode of module.legacyCodes) {
      await db.insert(schema.legacyModuleMap)
        .values({ moduleId: module.id, legacyCode })
      legacyCount++
    }
  }

  return { modules, prerequisiteCount, legacyCount }
}

// Run only when invoked directly, so the dev seed can import seedCatalogue.
if (import.meta.main) {
  const csvPath = process.argv[2] ?? join(import.meta.dirname, '../data/catalogue.csv')
  const db = openLocalDb()

  const { modules, prerequisiteCount, legacyCount } = await seedCatalogue(csvPath, db)

  const byStatus = modules.reduce<Record<string, number>>((acc, m) => {
    acc[m.status] = (acc[m.status] ?? 0) + 1
    return acc
  }, {})
  const byKind = modules.reduce<Record<string, number>>((acc, m) => {
    acc[m.kind] = (acc[m.kind] ?? 0) + 1
    return acc
  }, {})

  console.info(`Catalogue seeded from ${csvPath}`)
  console.info(`  ${modules.length} modules — ${Object.entries(byKind).map(([k, v]) => `${v} ${k}`).join(', ')}`)
  console.info(`  status: ${Object.entries(byStatus).map(([k, v]) => `${v} ${k}`).join(', ')}`)
  console.info(`  ${prerequisiteCount} prerequisites, ${legacyCount} legacy code mappings`)

  const placeholders = modules.filter(m => m.notes?.startsWith('PLACEHOLDER'))
  if (placeholders.length > 0) {
    console.warn(`\n⚠️  ${placeholders.length}/${modules.length} rows are PLACEHOLDER content, not the subcommittee's catalogue.`)
    console.warn('   See data/README.md — replace the CSV before this system carries any weight.')
  }

  const drafts = modules.filter(m => m.status === 'DRAFT').length
  if (drafts === modules.length) {
    console.info('\nEvery module is DRAFT, so ordinary members will see an empty catalogue.')
    console.info('Sign in via /dev-login?admin=1 to browse drafts.')
  }
}
