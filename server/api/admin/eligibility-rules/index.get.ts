/** GET /api/admin/eligibility-rules — the rules and what they currently require. */

import { db, schema } from '@nuxthub/db'
import { requirePermission } from '../../../utils/auth'
import { tryParseRequires } from '../../../utils/eligibility'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'config.manage')

  const rows = await db.select().from(schema.eligibilityRules).all()

  return {
    rules: rows
      .map(rule => ({
        key: rule.key,
        name: rule.name,
        description: rule.description,
        // null means unreadable, so the admin can see which rule to repair.
        requires: tryParseRequires(rule.requires),
        updatedAt: rule.updatedAt,
      }))
      .sort((a, b) => a.key.localeCompare(b.key)),
  }
})
