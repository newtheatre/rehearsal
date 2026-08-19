import { db, schema } from '@nuxthub/db'
import { asc } from 'drizzle-orm'
import { APP_MANIFEST } from '../../../../shared/utils/appManifest'
import { requireHookAuth } from '../../../utils/hookAuth'

/** This app's declaration, polled by the auth service. */
export default defineEventHandler(async (event) => {
  requireHookAuth(event)

  // Read from the table, never a literal: a rule the auth service cannot see
  // is a rule nobody can gate on.
  const rules = await db.select({
    key: schema.eligibilityRules.key,
    name: schema.eligibilityRules.name,
  }).from(schema.eligibilityRules).orderBy(asc(schema.eligibilityRules.key)).all()

  return { ...APP_MANIFEST, eligibilityRules: rules }
})
