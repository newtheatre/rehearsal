/**
 * GET /api/me/records: your own training, for the dashboard.
 */

import { db, schema } from '@nuxthub/db'
import { and, eq, ne } from 'drizzle-orm'
import { useAbilities } from '../../utils/abilities'
import { getConfigNumber } from '../../utils/siteConfig'
import { currentRecordsFor } from '../../utils/records'
import { checkPrerequisitesForCohort } from '../../utils/prerequisites'

export default defineEventHandler(async (event) => {
  const abilities = await useAbilities(event)
  const warningWindowDays = await getConfigNumber('warning_window_days')

  const records = await currentRecordsFor(abilities.user.id, { warningWindowDays })
  const held = new Set(records.filter(r => r.state !== 'EXPIRED').map(r => r.moduleId))

  const candidates = await db.select().from(schema.modules)
    .where(and(eq(schema.modules.status, 'ACTIVE'), ne(schema.modules.kind, 'BRIEF')))
    .all()

  const unheld = candidates.filter(module => !held.has(module.id))
  const checks = await checkPrerequisitesForCohort(
    [abilities.user.id],
    unheld.map(m => m.id),
    { warningWindowDays },
  )

  const nextUp = unheld
    .filter(module => checks.get(`${abilities.user.id}:${module.id}`)?.met)
    .map(module => ({ id: module.id, name: module.name, department: module.department, kind: module.kind }))

  return {
    records: records.filter(r => r.kind !== 'BRIEF'),
    briefs: records.filter(r => r.kind === 'BRIEF'),
    expiring: records.filter(r => r.state === 'EXPIRING'),
    expired: records.filter(r => r.state === 'EXPIRED'),
    nextUp: nextUp.slice(0, 12),
  }
})
