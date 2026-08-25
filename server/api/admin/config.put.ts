/**
 * PUT /api/admin/config: change an operator-tunable value.
 */

import { db, schema } from '@nuxthub/db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { requirePermission } from '../../utils/auth'
import { writeAudit } from '../../utils/audit'
import { CONFIG_DEFAULTS } from '../../../shared/utils/configDefaults'
import { isAcademicYearBoundary } from '../../utils/expiry'

const schemas = {
  warning_window_days: z.coerce.number().int().min(1).max(365).transform(String),
  // Month first, and a day that exists: 31-08 or 09-31 would stamp an expiry
  // no date parser accepts, which every gate then reads as valid.
  academic_year_end: z.string().trim()
    .refine(isAcademicYearBoundary, 'Use MM-DD, month first, e.g. 08-31'),
  session_edit_window_days: z.coerce.number().int().min(0).max(365).transform(String),
  notifications_mode: z.enum(['dry-run', 'live']),
  admin_cache_days: z.coerce.number().int().min(1).max(3650).transform(String),
  session_reminder_days: z.coerce.number().int().min(0).max(14).transform(String),
  register_nag_days: z.coerce.number().int().min(0).max(30).transform(String),
  register_nag_stop_days: z.coerce.number().int().min(1).max(3650).transform(String),
  practice_window_grace_hours: z.coerce.number().int().min(0).max(48).transform(String),
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
