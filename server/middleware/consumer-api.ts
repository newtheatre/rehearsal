/**
 * Every /api/v1 route needs a service token. Enforced here, so a new route
 * cannot be born public just because its author forgot the guard.
 */

import { requireServiceToken, setConsumerCacheHeaders } from '../utils/serviceToken'

export default defineEventHandler(async (event) => {
  const path = event.path.split('?')[0]!
  if (!path.startsWith('/api/v1/')) return

  await requireServiceToken(event)
  setConsumerCacheHeaders(event)
})
