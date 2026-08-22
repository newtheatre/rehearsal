/** POST /api/module-requests: ask for a module to be taught. */

import { moduleRequestSchema } from '../../utils/validation'
import { useAbilities } from '../../utils/abilities'
import { loadModules } from '../../utils/records'
import { requestModule } from '../../utils/moduleRequests'

export default defineEventHandler(async (event) => {
  const abilities = await useAbilities(event)
  const input = await readValidatedBody(event, moduleRequestSchema.parse)

  const [module] = await loadModules([input.moduleId])
  if (!module || module.status !== 'ACTIVE') {
    throw createError({
      statusCode: 400,
      statusMessage: 'That module is not currently offered',
    })
  }

  const { id } = await requestModule({
    userId: abilities.user.id,
    moduleId: input.moduleId,
    note: input.note,
  })

  setResponseStatus(event, 201)
  return { id, moduleId: input.moduleId }
})
