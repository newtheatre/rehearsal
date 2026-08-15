/**
 * GET /api/modules/:id — module detail with prerequisites and dependents.
 */

import { moduleIdSchema } from '../../utils/validation'
import { getModuleDetail } from '../../utils/modules'
import { useAbilities } from '../../utils/abilities'

export default defineEventHandler(async (event) => {
  const abilities = await useAbilities(event)

  const parsed = moduleIdSchema.safeParse(getRouterParam(event, 'id'))
  if (!parsed.success) {
    throw createError({ statusCode: 404, statusMessage: 'Module not found' })
  }

  const module = await getModuleDetail(parsed.data, abilities)
  if (!module) {
    throw createError({ statusCode: 404, statusMessage: 'Module not found' })
  }

  return module
})
