/**
 * Operator-tunable values that must not require a deploy
 * (docs/data-model.md §site_config).
 *
 * Reads fall back to these defaults when the row is absent, so a fresh or
 * partially-seeded database behaves identically to a configured one — a
 * missing config row must never change safety semantics.
 */

import { db, schema } from '@nuxthub/db'
import { eq } from 'drizzle-orm'

export const CONFIG_DEFAULTS = {
  warning_window_days: '60',
  academic_year_end: '09-30',
  session_edit_window_days: '14',
  notifications_mode: 'dry-run',
} as const

export type ConfigKey = keyof typeof CONFIG_DEFAULTS

export async function getConfig(key: ConfigKey): Promise<string> {
  const row = await db.select().from(schema.siteConfig)
    .where(eq(schema.siteConfig.key, key)).get()
  return row?.value ?? CONFIG_DEFAULTS[key]
}

export async function getConfigNumber(key: ConfigKey): Promise<number> {
  const parsed = Number(await getConfig(key))
  return Number.isFinite(parsed) ? parsed : Number(CONFIG_DEFAULTS[key])
}
