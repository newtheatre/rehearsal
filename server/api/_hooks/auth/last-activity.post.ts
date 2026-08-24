/**
 * POST /api/_hooks/auth/last-activity: feeds the auth service's inactivity
 * sweep (docs/gdpr-retention.md).
 */

import { db, schema } from '@nuxthub/db'
import { inArray, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireHookAuth } from '../../../utils/hookAuth'
import { chunk } from '../../../utils/d1'

const bodySchema = z.object({ userIds: z.array(z.string().min(1)).max(500) })

/** `awarded_at` is an ISO date; the contract wants epoch ms. */
function isoDateToEpoch(date: string): number {
  return Date.parse(`${date}T00:00:00Z`)
}

export default defineEventHandler(async (event) => {
  requireHookAuth(event)
  const { userIds } = await readValidatedBody(event, bodySchema.parse)

  const latest = new Map<string, number | null>()
  const note = (userId: string, at: number | null) => {
    if (at === null) return
    const current = latest.get(userId)
    if (current === undefined || current === null || at > current) latest.set(userId, at)
  }

  // Chunked for D1's bound-parameter cap (d1.ts). This is the endpoint
  // that gets a big list.
  for (const batch of chunk(userIds)) {
    const [records, attended, delivered] = await Promise.all([
      db.select({ userId: schema.records.userId, awardedAt: schema.records.awardedAt })
        .from(schema.records).where(inArray(schema.records.userId, batch)).all(),
      db.select({
        userId: schema.sessionAttendees.userId,
        heldOn: schema.sessions.heldOn,
        status: schema.sessionAttendees.status,
        signedUpAt: schema.sessionAttendees.signedUpAt,
      })
        .from(schema.sessionAttendees)
        .innerJoin(schema.sessions, eq(schema.sessionAttendees.sessionId, schema.sessions.id))
        .where(inArray(schema.sessionAttendees.userId, batch)).all(),
      db.select({
        userId: schema.sessions.trainerUserId,
        heldOn: schema.sessions.heldOn,
        status: schema.sessions.status,
        createdAt: schema.sessions.createdAt,
      })
        .from(schema.sessions)
        .where(inArray(schema.sessions.trainerUserId, batch)).all(),
    ])

    for (const row of records) note(row.userId, isoDateToEpoch(row.awardedAt))

    // A scheduled session's held_on is in the future, so it is activity only
    // once it has happened; before that, signing up or booking it is.
    for (const row of attended) {
      note(row.userId, row.status === 'ATTENDED'
        ? isoDateToEpoch(row.heldOn)
        : row.signedUpAt?.getTime() ?? null)
    }
    for (const row of delivered) {
      note(row.userId, row.status === 'DELIVERED'
        ? isoDateToEpoch(row.heldOn)
        : row.createdAt.getTime())
    }
  }

  return Object.fromEntries(userIds.map(id => [id, latest.get(id) ?? null]))
})
