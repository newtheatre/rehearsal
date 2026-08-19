/**
 * Every /api/_hooks route carries the auth service's shared secret. Enforced
 * here for the same reason as the consumer API: a forgotten guard is silent.
 */

import { requireHookAuth } from '../utils/hookAuth'

export default defineEventHandler((event) => {
  const path = event.path.split('?')[0]!
  if (!path.startsWith('/api/_hooks/')) return

  requireHookAuth(event)
})
