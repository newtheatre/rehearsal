/**
 * GET /api/directory: id and name only, for attendee and lead pickers.
 */

import { db, schema } from '@nuxthub/db'
import { asc, like } from 'drizzle-orm'
import { z } from 'zod'
import { useAbilities } from '../utils/abilities'

const querySchema = z.object({
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(500),
})

export default defineEventHandler(async (event) => {
  await useAbilities(event)
  const { q, limit } = await getValidatedQuery(event, querySchema.parse)

  // No records join: a picker needs names, not training state, and this is
  // what keeps it cheap enough to return the whole membership.
  const people = await db.select({ id: schema.users.id, name: schema.users.name })
    .from(schema.users)
    .where(q ? like(schema.users.name, `%${q}%`) : undefined)
    .orderBy(asc(schema.users.name), asc(schema.users.id))
    .limit(limit)
    .all()

  return { people }
})
