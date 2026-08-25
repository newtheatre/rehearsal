/**
 * Nitro logs an unhandled error's stack and nothing else, so a D1 failure
 * reaches the log with no message at all (ADR-0016).
 */

import { dbFailureLine, describeDbFailure } from '../utils/dbError'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('error', (error, { event }) => {
    if (!describeDbFailure(error)) return

    // event.path carries the query string, and a directory search names a member.
    const path = event?.path.split('?')[0] ?? 'unknown path'
    console.error(dbFailureLine(`${event?.method ?? '?'} ${path}`, error))
  })
})
