/**
 * GET /api/modules — the catalogue.
 *
 * Session-authenticated (global middleware). DRAFT modules appear only for
 * department leads and admins; the filter lives in listModules so no screen
 * can forget it.
 */

import { moduleListQuerySchema } from '../../utils/validation'
import { listModules } from '../../utils/modules'
import { useAbilities } from '../../utils/abilities'

export default defineEventHandler(async (event) => {
  const abilities = await useAbilities(event)
  const filters = await getValidatedQuery(event, moduleListQuerySchema.parse)

  return { modules: await listModules(abilities, filters) }
})
