/**
 * Emit the catalogue as SQL for production D1, through the same parser the
 * local seed uses. Idempotent; never deletes a module. docs/migration.md §1
 */

import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, join } from 'node:path'
import { parseCatalogue } from './lib/catalogue'
import { DEPARTMENTS } from './lib/departments'

import type { ParsedModule } from './lib/catalogue'

const q = (value: string | null) =>
  value === null ? 'null' : `'${value.replace(/'/g, '\'\'')}'`
const b = (value: boolean) => (value ? 1 : 0)
const n = (value: number | null) => (value === null ? 'null' : String(value))

export function buildCatalogueSql(modules: ParsedModule[], source: string, batchId: string): string {
  const lines: string[] = []
  lines.push(`-- Generated from ${source} by scripts/catalogue-sql.ts`)
  lines.push(`-- ${modules.length} modules. Idempotent: safe to re-run.`)

  for (const department of DEPARTMENTS) {
    lines.push(
      `insert into departments (code, name, sort) values (${q(department.code)}, ${q(department.name)}, ${department.sort}) `
      + `on conflict(code) do update set name = excluded.name, sort = excluded.sort;`,
    )
  }

  for (const module of modules) {
    lines.push(
      `insert into modules (id, department, kind, name, description, notes, materials_url, `
      + `expiry_mode, expiry_months, safety_critical, signoff_required, grants_supervisor, grants_trainer, `
      + `status, sort, created_at, updated_at) values (`
      + [
        q(module.id), q(module.department), q(module.kind), q(module.name),
        q(module.description), q(module.notes), q(module.materialsUrl),
        q(module.expiryMode), n(module.expiryMonths),
        b(module.safetyCritical), b(module.signoffRequired),
        b(module.grantsSupervisor), b(module.grantsTrainer),
        q(module.status), module.sort,
        'unixepoch() * 1000', 'unixepoch() * 1000',
      ].join(', ')
      + `) on conflict(id) do update set `
      + `department = excluded.department, kind = excluded.kind, name = excluded.name, `
      + `description = excluded.description, notes = excluded.notes, materials_url = excluded.materials_url, `
      + `expiry_mode = excluded.expiry_mode, expiry_months = excluded.expiry_months, `
      + `safety_critical = excluded.safety_critical, signoff_required = excluded.signoff_required, `
      // status is deliberately absent: it is set operationally in /admin, and
      // a regeneration must not unpublish what a lead activated.
      + `grants_supervisor = excluded.grants_supervisor, grants_trainer = excluded.grants_trainer, `
      + `sort = excluded.sort, updated_at = unixepoch() * 1000;`,
    )
  }

  // Replaced wholesale per module so an edit that removes a prerequisite removes it.
  const ids = modules.map(m => q(m.id)).join(', ')
  lines.push(`delete from module_prerequisites where module_id in (${ids});`)
  lines.push(`delete from legacy_module_map where module_id in (${ids});`)

  let edge = 0
  for (const module of modules) {
    for (const requires of module.prerequisites) {
      lines.push(
        `insert into module_prerequisites (id, module_id, requires_module_id) `
        + `values (${q(`pre-${edge++}-${module.id}-${requires}`)}, ${q(module.id)}, ${q(requires)});`,
      )
    }
    for (const legacyCode of module.legacyCodes) {
      lines.push(
        `insert into legacy_module_map (id, module_id, legacy_code) `
        + `values (${q(`leg-${module.id}-${legacyCode}`)}, ${q(module.id)}, ${q(legacyCode)});`,
      )
    }
  }

  // Invariant 9: an import is a privileged mutation, so it leaves a trace.
  lines.push(
    `insert into audit_log (id, actor_user_id, action, target, detail, created_at) values (`
    + [
      q(`import-${batchId}`), 'null', q('catalogue.import'), q(source),
      q(JSON.stringify({
        modules: modules.length,
        batchId,
        note: 'status is not overwritten by an import',
      })),
      'unixepoch() * 1000',
    ].join(', ')
    + `) on conflict(id) do nothing;`,
  )

  return lines.join('\n')
}

// Only when run as a script: tests import the builder above.
if (import.meta.main) {
  const csvPath = process.argv[2] ?? join(import.meta.dirname, '../data/catalogue.csv')
  const csv = readFileSync(csvPath)
  // Deterministic, so re-running the same file does not add a second entry.
  const batchId = createHash('sha256').update(csv).digest('hex').slice(0, 12)

  console.log(buildCatalogueSql(parseCatalogue(csv.toString('utf8'), csvPath), basename(csvPath), batchId))
}
