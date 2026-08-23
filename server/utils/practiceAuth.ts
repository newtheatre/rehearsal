/**
 * Somebody must already be mirrored here before they can be named: ids are
 * canonical auth ids and are never minted locally (CLAUDE.md invariant 7).
 */

import { db, schema } from '@nuxthub/db'
import { eq } from 'drizzle-orm'

export async function ensureKnownUser(userId: string): Promise<void> {
  const user = await db.select({ id: schema.users.id }).from(schema.users)
    .where(eq(schema.users.id, userId)).get()

  if (!user) {
    throw createError({
      statusCode: 404,
      statusMessage: 'That person has not used the training system yet',
    })
  }
}
