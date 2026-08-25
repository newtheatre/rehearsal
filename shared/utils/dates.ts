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

/**
 * A wall-clock date and HH:MM in Europe/London, as an instant. The Worker runs
 * in UTC and a browser runs in whatever the device says, so neither may parse it.
 */
export function londonInstant(isoDate: string, hhmm: string): Date {
  const guess = new Date(`${isoDate}T${hhmm}:00Z`)
  // Correct the guess by London's offset at that moment, which is what turns
  // a wall-clock reading into the instant it names.
  return new Date(guess.getTime() - londonOffsetMs(guess))
}

/** The HH:MM an instant reads as in Europe/London. */
export function londonTimeOf(at: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE, hour12: false, hour: '2-digit', minute: '2-digit',
  }).format(at)
}

function londonOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at)

  const get = (type: string) => Number(parts.find(part => part.type === type)?.value ?? 0)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'))
  return asUtc - at.getTime()
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

/** `isoDate` plus N calendar months, clamped to the end of a short month. */
export function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const target = new Date(Date.UTC(y!, m! - 1 + months, 1))
  // Clamp: 31 Jan + 1 month is 28/29 Feb, not 3 March.
  const lastDayOfTargetMonth = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(d!, lastDayOfTargetMonth))
  return target.toISOString().slice(0, 10)
}
