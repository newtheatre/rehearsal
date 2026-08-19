/** GET /api/sessions: the delivery log, newest first. Any member may read it. */

import { listSessions } from '../../utils/sessions'
import { useAbilities } from '../../utils/abilities'

export default defineEventHandler(async (event) => {
  await useAbilities(event)
  return { sessions: await listSessions() }
})
