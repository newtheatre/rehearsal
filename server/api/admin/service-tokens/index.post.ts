/**
 * POST /api/admin/service-tokens: issue a token for a consumer app.
 */

import { db, schema } from '@nuxthub/db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { requirePermission } from '../../../utils/auth'
import { createServiceToken } from '../../../utils/serviceToken'
import { writeAudit } from '../../../utils/audit'

const bodySchema = z.object({
  name: z.string().trim().min(2).max(60)
    .regex(/^[a-z0-9-]+$/, 'Lowercase letters, numbers and hyphens, name it after the consumer app'),
})

export default defineEventHandler(async (event) => {
  const admin = await requirePermission(event, 'config.manage')
  const { name } = await readValidatedBody(event, bodySchema.parse)

  const existing = await db.select({ id: schema.serviceTokens.id })
    .from(schema.serviceTokens).where(eq(schema.serviceTokens.name, name)).get()
  if (existing) {
    throw createError({
      statusCode: 409,
      statusMessage: `A token named "${name}" already exists: revoke it first, or pick another name`,
    })
  }

  const { id, token } = await createServiceToken(name)

  await writeAudit({
    actorUserId: admin.id,
    action: 'service-token.issue',
    target: id,
    // The token itself is never audited: only that one was issued, to whom.
    detail: { name },
  })

  setResponseStatus(event, 201)
  return { id, name, token }
})
