/**
 * Every date is pinned to Europe/London. The Worker runs in UTC, so an
 * unpinned date is a day out for the first hour of every BST day.
 */

export const TIMEZONE = 'Europe/London'

const isoFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE })

/** Today as an ISO date (YYYY-MM-DD), in Europe/London. */
export function today(now: Date = new Date()): string {
  return isoFormatter.format(now)
}

/** Whole days from `from` to `to`, both ISO dates. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  return Math.round((b - a) / 86_400_000)
}

/** A stored ISO date (YYYY-MM-DD) as DD/MM/YYYY. */
export function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-')
  return `${day}/${month}/${year}`
}

/** A timestamp as a London date and time. Seconds for the audit trail. */
export function formatDateTime(value: string | Date | number, { seconds = false } = {}): string {
  return new Date(value).toLocaleString('en-GB', {
    timeZone: TIMEZONE,
    dateStyle: 'short',
    timeStyle: seconds ? 'medium' : 'short',
  })
}
