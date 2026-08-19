/** GET /api/admin/config: the operator-tunable values and their defaults. */

import { db, schema } from '@nuxthub/db'
import { requirePermission } from '../../utils/auth'
import { CONFIG_DEFAULTS, type ConfigKey } from '../../../shared/utils/configDefaults'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'config.manage')

  const rows = await db.select().from(schema.siteConfig).all()
  const stored = new Map(rows.map(r => [r.key, r.value]))

  return {
    config: (Object.keys(CONFIG_DEFAULTS) as ConfigKey[]).map(key => ({
      key,
      value: stored.get(key) ?? CONFIG_DEFAULTS[key],
      default: CONFIG_DEFAULTS[key],
      // A row that has never been written still behaves correctly; saying so
      // stops anyone "fixing" a blank by guessing.
      isDefault: !stored.has(key),
    })),
  }
})
