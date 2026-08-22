/** GET /api/admin/practice-targets: which modules have a sandbox, and where. */

import { requirePermission } from '../../../utils/auth'
import { listTargets, openWindows } from '../../../utils/practice'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'config.manage')

  const [targets, open] = await Promise.all([listTargets(), openWindows()])

  return {
    targets: targets.map(target => ({
      ...target,
      openWindows: open.filter(window => window.targetKey === target.key).length,
    })),
    open,
  }
})
