/** GET /api/admin/eligibility-rules — the rules and what they currently require. */

import { db, schema } from '@nuxthub/db'
import { requirePermission } from '../../../utils/auth'
import { parseRequires } from '../../../utils/eligibility'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'config.manage')

  const rows = await db.select().from(schema.eligibilityRules).all()

  return {
    rules: rows
      .map(rule => ({
        key: rule.key,
        name: rule.name,
        description: rule.description,
        requires: parseRequires(rule.requires),
        updatedAt: rule.updatedAt,
      }))
      .sort((a, b) => a.key.localeCompare(b.key)),
  }
})
