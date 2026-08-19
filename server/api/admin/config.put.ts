/**
 * PUT /api/admin/config: change an operator-tunable value.
 */

import { db, schema } from '@nuxthub/db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { requirePermission } from '../../utils/auth'
import { writeAudit } from '../../utils/audit'
import { CONFIG_DEFAULTS } from '../../../shared/utils/configDefaults'

const schemas = {
  warning_window_days: z.coerce.number().int().min(1).max(365).transform(String),
  academic_year_end: z.string().regex(/^\d{2}-\d{2}$/, 'Use MM-DD, e.g. 09-30'),
  session_edit_window_days: z.coerce.number().int().min(0).max(365).transform(String),
  notifications_mode: z.enum(['dry-run', 'live']),
} as const

const bodySchema = z.object({
  key: z.enum(Object.keys(CONFIG_DEFAULTS) as [keyof typeof CONFIG_DEFAULTS]),
  value: z.union([z.string(), z.number()]),
})

export default defineEventHandler(async (event) => {
  const admin = await requirePermission(event, 'config.manage')
  const { key, value } = await readValidatedBody(event, bodySchema.parse)

  const parsed = schemas[key].safeParse(value)
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues[0]?.message ?? `Invalid value for ${key}`,
    })
  }

  const existing = await db.select().from(schema.siteConfig)
    .where(eq(schema.siteConfig.key, key)).get()
  const previous = existing?.value ?? CONFIG_DEFAULTS[key]

  await db.insert(schema.siteConfig)
    .values({ key, value: parsed.data })
    .onConflictDoUpdate({
      target: schema.siteConfig.key,
      set: { value: parsed.data, updatedAt: new Date() },
    })

  await writeAudit({
    actorUserId: admin.id,
    action: 'config.update',
    target: key,
    detail: { from: previous, to: parsed.data },
  })

  return { key, value: parsed.data, previous }
})
