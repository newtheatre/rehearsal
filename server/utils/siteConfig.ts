/**
 * Operator-tunable values that must not require a deploy
 * (docs/data-model.md §site_config).
 *
 * Reads fall back to the shared defaults when the row is absent, so a fresh
 * or partially-seeded database behaves identically to a configured one — a
 * missing config row must never change safety semantics.
 */

import { db, schema } from '@nuxthub/db'
import { eq } from 'drizzle-orm'
import { CONFIG_DEFAULTS, type ConfigKey } from '../../shared/utils/configDefaults'

export async function getConfig(key: ConfigKey): Promise<string> {
  const row = await db.select().from(schema.siteConfig)
    .where(eq(schema.siteConfig.key, key)).get()
  return row?.value ?? CONFIG_DEFAULTS[key]
}

export async function getConfigNumber(key: ConfigKey): Promise<number> {
  const parsed = Number(await getConfig(key))
  return Number.isFinite(parsed) ? parsed : Number(CONFIG_DEFAULTS[key])
}
