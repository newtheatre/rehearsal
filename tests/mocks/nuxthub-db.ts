/**
 * The same schema on in-memory sqlite with the real migration applied, so
 * tests exercise the production DDL. libsql: Bun cannot load the native one.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import * as catalogueSchema from '../../server/db/schema/catalogue'
import * as userSchema from '../../server/db/schema/user'
import * as trainingSchema from '../../server/db/schema/training'
import * as practiceSchema from '../../server/db/schema/practice'
import * as serviceSchema from '../../server/db/schema/service'
import * as auditSchema from '../../server/db/schema/audit'

export const schema = {
  ...catalogueSchema,
  ...userSchema,
  ...trainingSchema,
  ...practiceSchema,
  ...serviceSchema,
  ...auditSchema,
}

const client = createClient({ url: ':memory:' })

const migrationsDir = join(import.meta.dirname, '../../server/db/migrations/sqlite')
for (const file of readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()) {
  const migration = readFileSync(join(migrationsDir, file), 'utf8')
  for (const statement of migration.split('--> statement-breakpoint')) {
    if (statement.trim()) await client.execute(statement)
  }
}

await client.execute('PRAGMA foreign_keys = ON')

// Test seam: the cohort reads exist to keep query counts off the row count,
// so a test needs to be able to see them.
let queries = 0
const rawExecute = client.execute.bind(client)
const rawBatch = client.batch.bind(client)
client.execute = ((...args: Parameters<typeof rawExecute>) => {
  queries++
  return rawExecute(...args)
}) as typeof client.execute
client.batch = ((...args: Parameters<typeof rawBatch>) => {
  queries++
  return rawBatch(...args)
}) as typeof client.batch

export function countQueries(): number {
  return queries
}

export function resetQueryCount(): void {
  queries = 0
}

export const db = drizzle(client, { schema })

/** Wipe all rows between tests (schema stays). */
export async function resetDb(): Promise<void> {
  for (const table of [
    'notification_log',
    'audit_log',
    'practice_windows',
    'practice_targets',
    'records',
    // Before sessions and modules: it references both.
    'module_requests',
    'session_attendees',
    'session_modules',
    'sessions',
    'module_prerequisites',
    'legacy_module_map',
    'department_leads',
    'eligibility_rules',
    'service_tokens',
    'site_config',
    'modules',
    'departments',
    'users',
  ]) {
    await client.execute(`DELETE FROM ${table}`)
  }
}
