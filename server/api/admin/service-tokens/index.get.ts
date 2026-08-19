/** GET /api/admin/service-tokens: issued tokens. Never the tokens themselves. */

import { db, schema } from '@nuxthub/db'
import { desc } from 'drizzle-orm'
import { requirePermission } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'config.manage')

  const rows = await db.select({
    id: schema.serviceTokens.id,
    name: schema.serviceTokens.name,
    scopes: schema.serviceTokens.scopes,
    createdAt: schema.serviceTokens.createdAt,
    lastUsedAt: schema.serviceTokens.lastUsedAt,
  })
    .from(schema.serviceTokens)
    .orderBy(desc(schema.serviceTokens.createdAt))
    .all()

  return { tokens: rows }
})
