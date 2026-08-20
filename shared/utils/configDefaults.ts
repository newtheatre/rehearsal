/**
 * Defaults for site_config, kept apart from the server-only accessor so
 * scripts and tests can read them without a database binding.
 */
export const CONFIG_DEFAULTS = {
  warning_window_days: '60',
  academic_year_end: '08-31',
  session_edit_window_days: '14',
  notifications_mode: 'dry-run',
  admin_cache_days: '90',
} as const

export type ConfigKey = keyof typeof CONFIG_DEFAULTS
