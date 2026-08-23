import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'
import { nanoid } from 'nanoid'

/**
 * Append-only; every privileged mutation writes here (CLAUDE.md invariant 9).
 * Import batches carry their batch id so a bad import can be bulk-revoked.
 */
export const auditLog = sqliteTable('audit_log', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  actorUserId: text('actor_user_id'), // null = cron / import / system
  action: text('action').notNull(), // 'module.create', 'record.revoke', …
  target: text('target').notNull(), // the id acted upon
  detail: text('detail'), // JSON
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
}, table => [
  index('audit_log_actor_idx').on(table.actorUserId),
  index('audit_log_action_idx').on(table.action),
  index('audit_log_created_at_idx').on(table.createdAt),
])

/**
 * Idempotency ledger for the expiry cron: one row per (record, type) sent, so
 * a re-run sends nothing new. Pruned after 24 months.
 */
export const notificationLog = sqliteTable('notification_log', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  userId: text('user_id').notNull(),
  type: text('type').notNull(), // 'expiry.window', 'expiry.14day', 'digest.monthly'
  recordId: text('record_id'),
  moduleId: text('module_id'),
  sessionId: text('session_id'), // set for the session reminder and register nag
  sentAt: integer('sent_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
}, table => [
  index('notification_log_user_idx').on(table.userId),
  index('notification_log_record_type_idx').on(table.recordId, table.type),
  index('notification_log_session_type_idx').on(table.sessionId, table.type),
])
