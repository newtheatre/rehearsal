/**
 * GET /api/modules — the catalogue.
 */

import { moduleListQuerySchema } from '../../utils/validation'
import { listModules } from '../../utils/modules'
import { useAbilities } from '../../utils/abilities'

export default defineEventHandler(async (event) => {
  const abilities = await useAbilities(event)
  const filters = await getValidatedQuery(event, moduleListQuerySchema.parse)

  return { modules: await listModules(abilities, filters) }
})
