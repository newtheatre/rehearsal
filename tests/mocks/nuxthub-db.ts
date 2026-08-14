/**
 * Test stand-in for the `@nuxthub/db` virtual module: the same Drizzle
 * schema, backed by in-memory SQLite, with the real generated migration
 * applied so tests exercise the production DDL.
 *
 * libsql rather than better-sqlite3 — the native module doesn't load under
 * Bun, and the driver is already a dependency of the seed scripts.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import * as catalogueSchema from '../../server/db/schema/catalogue'
import * as userSchema from '../../server/db/schema/user'
import * as trainingSchema from '../../server/db/schema/training'
import * as serviceSchema from '../../server/db/schema/service'
import * as auditSchema from '../../server/db/schema/audit'

export const schema = {
  ...catalogueSchema,
  ...userSchema,
  ...trainingSchema,
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

export const db = drizzle(client, { schema })

/** Wipe all rows between tests (schema stays). */
export async function resetDb(): Promise<void> {
  for (const table of [
    'notification_log',
    'audit_log',
    'records',
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
