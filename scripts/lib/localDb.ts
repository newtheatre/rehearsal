/**
 * Local-database connection for the seed and import scripts. These never
 * touch production D1: that is `wrangler d1`, a different runbook.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import * as catalogue from '../../server/db/schema/catalogue'
import * as user from '../../server/db/schema/user'
import * as training from '../../server/db/schema/training'
import * as service from '../../server/db/schema/service'
import * as audit from '../../server/db/schema/audit'

export const schema = { ...catalogue, ...user, ...training, ...service, ...audit }

export function openLocalDb() {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to run: NODE_ENV is production.')
    process.exit(1)
  }

  if (process.env.NUXT_HUB_CLOUDFLARE_DATABASE_ID || process.env.NUXT_HUB_CLOUDFLARE_API_TOKEN) {
    console.error('Refusing to run: remote D1 credentials are set in this environment.')
    process.exit(1)
  }

  const dbPath = join(import.meta.dirname, '../../.data/db/sqlite.db')
  if (!existsSync(dbPath)) {
    console.error(`No local database at ${dbPath}, run \`bun run db:migrate\` (or \`bun run dev\` once) first.`)
    process.exit(1)
  }

  return drizzle(createClient({ url: `file:${dbPath}` }), { schema })
}
