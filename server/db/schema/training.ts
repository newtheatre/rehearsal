import { sqliteTable, text, integer, index, unique } from 'drizzle-orm/sqlite-core'
import { relations } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { users } from './user'
import { modules } from './catalogue'

/**
 * Training sessions: the who-trained-whom audit trail. Completion records
 * derive from these (docs/architecture.md §key-flows). Editable by their
 * trainer/admin for site_config.session_edit_window_days; after that,
 * corrections are revoke + re-grant.
 */
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  heldOn: text('held_on').notNull(), // ISO date — when the training happened
  trainerUserId: text('trainer_user_id').notNull().references(() => users.id),
  location: text('location'),
  notes: text('notes'), // free text; in the anonymisation scrub list
  createdBy: text('created_by').notNull().references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
}, table => [
  index('sessions_held_on_idx').on(table.heldOn),
  index('sessions_trainer_idx').on(table.trainerUserId),
])

export const sessionModules = sqliteTable('session_modules', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  moduleId: text('module_id').notNull().references(() => modules.id),
}, table => [
  unique('session_modules_pair_unq').on(table.sessionId, table.moduleId),
])

export const sessionAttendees = sqliteTable('session_attendees', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id),
}, table => [
  unique('session_attendees_pair_unq').on(table.sessionId, table.userId),
  index('session_attendees_user_idx').on(table.userId),
])

/**
 * A record says: this person completed this module on this date, and here is
 * the evidence chain (docs/records-and-expiry.md).
 *
 * Append-only (ADR-0008): corrections are revocations plus new grants. No
 * handler, migration or script may hard-delete a row here.
 *
 * `expires_at` is stamped once at creation from the module's policy at that
 * moment (ADR-0002) and never recomputed implicitly. Validity state is
 * always derived from it at read time — there is deliberately no state
 * column (CLAUDE.md invariant 4).
 */
export const records = sqliteTable('records', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  userId: text('user_id').notNull().references(() => users.id),
  moduleId: text('module_id').notNull().references(() => modules.id),

  awardedAt: text('awarded_at').notNull(), // ISO date — when training happened
  expiresAt: text('expires_at'), // ISO date; NULL = never expires

  source: text('source', { enum: ['SESSION', 'SIGNOFF', 'EXTERNAL', 'LEGACY', 'ADMIN'] }).notNull(),
  sessionId: text('session_id').references(() => sessions.id), // set iff SESSION
  grantedBy: text('granted_by').references(() => users.id), // set for SIGNOFF/EXTERNAL/ADMIN
  externalRef: text('external_ref'), // e.g. 'SU EFAW cert, expires 2028-03-01'

  revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
  revokedBy: text('revoked_by').references(() => users.id),
  revokeReason: text('revoke_reason'), // mandatory on revocation; scrub list

  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()), // data entry, vs awardedAt
}, table => [
  index('records_current_idx').on(table.userId, table.moduleId, table.awardedAt),
  index('records_module_idx').on(table.moduleId),
  index('records_expires_at_idx').on(table.expiresAt),
])

export const sessionsRelations = relations(sessions, ({ one, many }) => ({
  trainer: one(users, {
    fields: [sessions.trainerUserId],
    references: [users.id],
  }),
  modules: many(sessionModules),
  attendees: many(sessionAttendees),
  records: many(records),
}))

export const sessionModulesRelations = relations(sessionModules, ({ one }) => ({
  session: one(sessions, {
    fields: [sessionModules.sessionId],
    references: [sessions.id],
  }),
  module: one(modules, {
    fields: [sessionModules.moduleId],
    references: [modules.id],
  }),
}))

export const sessionAttendeesRelations = relations(sessionAttendees, ({ one }) => ({
  session: one(sessions, {
    fields: [sessionAttendees.sessionId],
    references: [sessions.id],
  }),
  user: one(users, {
    fields: [sessionAttendees.userId],
    references: [users.id],
  }),
}))

export const recordsRelations = relations(records, ({ one }) => ({
  user: one(users, {
    fields: [records.userId],
    references: [users.id],
  }),
  module: one(modules, {
    fields: [records.moduleId],
    references: [modules.id],
  }),
  session: one(sessions, {
    fields: [records.sessionId],
    references: [sessions.id],
  }),
}))
