import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'
import { relations } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { users } from './user'
import { sessions } from './training'

/**
 * Which modules have a sandbox in a consumer app, as committee-editable data
 * (ADR-0014). Deliberately not eligibility_rules: they answer different questions.
 */
export const practiceTargets = sqliteTable('practice_targets', {
  key: text('key').primaryKey(), // 'bar-till': a consumer hardcodes it, so never rename one
  name: text('name').notNull(),
  description: text('description'),
  consumer: text('consumer'), // 'proscenium'; for the admin list, never authorisation
  // JSON array of module ids. Teaching any of them opens this sandbox.
  moduleIds: text('module_ids', { mode: 'json' }).notNull().$type<string[]>().default([]),
  graceHours: integer('grace_hours'), // overrides site_config.practice_window_grace_hours
  status: text('status', { enum: ['ACTIVE', 'RETIRED'] }).notNull().default('ACTIVE'),
  updatedBy: text('updated_by').references(() => users.id),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
})

/**
 * The only answer to "is this person being taught this right now". Opened by
 * a register or by a lead; consumers ask, and enforce for themselves.
 */
export const practiceWindows = sqliteTable('practice_windows', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  userId: text('user_id').notNull().references(() => users.id),
  targetKey: text('target_key').notNull().references(() => practiceTargets.key),
  sessionId: text('session_id').references(() => sessions.id), // null for an ad-hoc grant

  openedBy: text('opened_by').notNull().references(() => users.id),
  opensAt: integer('opens_at', { mode: 'timestamp_ms' }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),

  closedAt: integer('closed_at', { mode: 'timestamp_ms' }),
  closedBy: text('closed_by').references(() => users.id),
  reason: text('reason'), // required on an ad-hoc grant; scrub list
}, table => [
  index('practice_windows_user_idx').on(table.userId, table.targetKey),
  index('practice_windows_session_idx').on(table.sessionId),
  index('practice_windows_expires_idx').on(table.expiresAt),
])

export const practiceWindowsRelations = relations(practiceWindows, ({ one }) => ({
  user: one(users, { fields: [practiceWindows.userId], references: [users.id] }),
  target: one(practiceTargets, { fields: [practiceWindows.targetKey], references: [practiceTargets.key] }),
  session: one(sessions, { fields: [practiceWindows.sessionId], references: [sessions.id] }),
}))
