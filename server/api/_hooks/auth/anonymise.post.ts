/**
 * POST /api/_hooks/auth/anonymise — GDPR erasure, this app's share (docs/gdpr-
 * retention.md).
 */

import { db, schema } from '@nuxthub/db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireHookAuth } from '../../../utils/hookAuth'
import { writeAudit } from '../../../utils/audit'

const bodySchema = z.object({ userId: z.string().min(1) })

export default defineEventHandler(async (event) => {
  requireHookAuth(event)
  const { userId } = await readValidatedBody(event, bodySchema.parse)

  const user = await db.select({ id: schema.users.id }).from(schema.users)
    .where(eq(schema.users.id, userId)).get()

  if (!user) {
    // Nothing mirrored here — an erasure of someone who never trained.
    return { ok: true, mirrored: false }
  }

  await db.update(schema.users).set({
    email: `deleted-${userId}@anonymised.invalid`,
    name: 'Deleted user',
    isTrainingAdmin: false,
    updatedAt: new Date(),
  }).where(eq(schema.users.id, userId))

  await db.update(schema.records).set({ revokeReason: null })
    .where(eq(schema.records.userId, userId))

  await db.update(schema.sessions).set({ notes: null })
    .where(eq(schema.sessions.trainerUserId, userId))

  await writeAudit({
    actorUserId: null, // the auth service acting on the person's behalf
    action: 'user.anonymise',
    target: userId,
    detail: { via: 'auth-service hook' },
  })

  return { ok: true, mirrored: true }
})
