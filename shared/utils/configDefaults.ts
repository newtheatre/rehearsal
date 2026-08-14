/**
 * Defaults for the operator-tunable `site_config` values
 * (docs/data-model.md §site_config).
 *
 * Kept apart from the server-only accessor in `server/utils/siteConfig.ts` so
 * scripts and tests can read them without pulling in a database binding.
 *
 * A read falls back to these when the row is absent: a missing config row
 * must never change safety semantics.
 */
export const CONFIG_DEFAULTS = {
  warning_window_days: '60',
  academic_year_end: '09-30',
  session_edit_window_days: '14',
  notifications_mode: 'dry-run',
} as const

export type ConfigKey = keyof typeof CONFIG_DEFAULTS
