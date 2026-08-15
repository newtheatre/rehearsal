/**
 * Defaults for site_config, kept apart from the server-only accessor so
 * scripts and tests can read them without a database binding.
 */
export const CONFIG_DEFAULTS = {
  warning_window_days: '60',
  academic_year_end: '09-30',
  session_edit_window_days: '14',
  notifications_mode: 'dry-run',
} as const

export type ConfigKey = keyof typeof CONFIG_DEFAULTS
