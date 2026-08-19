import { db } from '@nuxthub/db'
import { sql } from 'drizzle-orm'
import journal from '../db/migrations/sqlite/meta/_journal.json'

/** GET /api/health: uptime check (public, docs/operations.md#monitoring). */
export default defineEventHandler(async (event) => {
  // Both ledger spellings exist: nuxt-db migrate records the bare tag,
  // wrangler records it with .sql. Compare on the tag.
  const expected = journal.entries.map(entry => entry.tag)
  let pending: string[] = []

  try {
    const rows = await db.all<{ name: string }>(sql`select name from _hub_migrations`)
    const applied = new Set(rows.map(r => r.name.replace(/\.sql$/, '')))
    pending = expected.filter(tag => !applied.has(tag))
  }
  catch (error) {
    console.error('[health] could not read _hub_migrations:', error)
    pending = expected
  }

  if (pending.length) {
    // The deployed code was built against a schema this database does not
    // have (stage-door ADR-0021).
    setResponseStatus(event, 503)
    return { ok: false, version: '0.1.0', pendingMigrations: pending }
  }

  return { ok: true, version: '0.1.0' }
})
