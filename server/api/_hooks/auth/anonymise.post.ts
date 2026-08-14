/**
 * POST /api/_hooks/auth/anonymise — GDPR erasure, this app's share
 * (docs/gdpr-retention.md). Idempotent.
 *
 * **Records survive**, as anonymous rows: who was trained to do what is what a
 * safety incident review needs. What goes is the identity and the free text
 * written about them:
 *
 * · the mirror row (email, name, admin cache)
 * · `revoke_reason` on their own records — it routinely names them
 * · `notes` on sessions they ran
 *
 * Free text elsewhere that happens to name them is not detectable and is not
 * scrubbed, which is why both of those fields are flagged to their authors as
 * visible on review.
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
