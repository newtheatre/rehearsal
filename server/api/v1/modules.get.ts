/**
 * GET /api/v1/modules — the catalogue, for consumers.
 *
 * ACTIVE only by default. `status=all` exists for admin tooling and is
 * explicitly not for gating: a DRAFT module is unratified content, and a
 * consumer treating it as real would be acting on something the subcommittee
 * hasn't agreed yet.
 */

import { db, schema } from '@nuxthub/db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireServiceToken, setConsumerCacheHeaders } from '../../utils/serviceToken'

const querySchema = z.object({
  status: z.enum(['ACTIVE', 'all']).default('ACTIVE'),
})

export default defineEventHandler(async (event) => {
  await requireServiceToken(event)
  const { status } = await getValidatedQuery(event, querySchema.parse)
  setConsumerCacheHeaders(event)

  const rows = await db.select({
    id: schema.modules.id,
    department: schema.modules.department,
    kind: schema.modules.kind,
    name: schema.modules.name,
    expiry_mode: schema.modules.expiryMode,
    expiry_months: schema.modules.expiryMonths,
    safety_critical: schema.modules.safetyCritical,
    status: schema.modules.status,
  })
    .from(schema.modules)
    .where(status === 'ACTIVE' ? eq(schema.modules.status, 'ACTIVE') : undefined)
    .all()

  return rows.sort((a, b) => a.id.localeCompare(b.id))
})
