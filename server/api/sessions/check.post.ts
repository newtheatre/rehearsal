/**
 * POST /api/sessions/check — what would this session actually record?
 */

import { sessionInputSchema } from '../../utils/validation'
import { requireTrainer } from '../../utils/auth'
import { getConfig, getConfigNumber } from '../../utils/siteConfig'
import { buildRecordInserts, loadModules } from '../../utils/records'
import { checkSessionPrerequisites } from '../../utils/sessions'

export default defineEventHandler(async (event) => {
  await requireTrainer(event)
  const input = await readValidatedBody(event, sessionInputSchema.parse)

  const [modules, warningWindowDays, academicYearEnd] = await Promise.all([
    loadModules(input.moduleIds),
    getConfigNumber('warning_window_days'),
    getConfig('academic_year_end'),
  ])

  const { warnings, blocking } = await checkSessionPrerequisites(
    modules,
    input.attendeeIds,
    { warningWindowDays },
  )

  const records = buildRecordInserts({
    users: input.attendeeIds,
    modules,
    awardedAt: input.heldOn,
    source: 'SESSION',
    academicYearEnd,
  })

  const byModule = new Map(modules.map(m => [m.id, m]))

  return {
    recordCount: records.length,
    records: records.map(record => ({
      userId: record.userId,
      moduleId: record.moduleId,
      moduleName: byModule.get(record.moduleId)?.name ?? record.moduleId,
      awardedAt: record.awardedAt,
      expiresAt: record.expiresAt,
    })),
    warnings,
    blocking,
  }
})
