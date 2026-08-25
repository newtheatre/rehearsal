import { sqliteTable, text, integer, index, unique, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { relations, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { users } from './user'
import { modules } from './catalogue'

export const SESSION_STATUSES = ['PLANNED', 'OPEN', 'FULL', 'DELIVERED', 'CANCELLED'] as const

/**
 * A scheduled session and a delivered one are the same row (ADR-0013).
 * Only DELIVERED sessions have records. docs/scheduling-design.md
 */
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  heldOn: text('held_on').notNull(), // ISO date: when the training happens
  trainerUserId: text('trainer_user_id').notNull().references(() => users.id),
  location: text('location'),
  notes: text('notes'), // free text; in the anonymisation scrub list
  createdBy: text('created_by').notNull().references(() => users.id),

  // Defaults to DELIVERED so existing rows backfill and a writer that forgets
  // creates something finished, not an unwatched sign-up sheet (ADR-0013).
  status: text('status', { enum: SESSION_STATUSES }).notNull().default('DELIVERED'),

  startsAt: integer('starts_at', { mode: 'timestamp_ms' }),
  endsAt: integer('ends_at', { mode: 'timestamp_ms' }),
  // Null is uncapped; capped at 60 in validation (design §5.3). A place is
  // derived from this, never stored, and FULL is only a badge (design §3.3).
  capacity: integer('capacity'),
  signupsCloseAt: integer('signups_close_at', { mode: 'timestamp_ms' }),
  // Stamped on the day. Opens practice windows rather than changing status.
  registerOpenedAt: integer('register_opened_at', { mode: 'timestamp_ms' }),
  deliveredAt: integer('delivered_at', { mode: 'timestamp_ms' }),
  cancelledAt: integer('cancelled_at', { mode: 'timestamp_ms' }),
  cancelReason: text('cancel_reason'), // emailed to everyone signed up
  description: text('description'), // what to bring, where to meet

  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
}, table => [
  index('sessions_held_on_idx').on(table.heldOn),
  index('sessions_trainer_idx').on(table.trainerUserId),
  index('sessions_status_idx').on(table.status),
])

export const sessionModules = sqliteTable('session_modules', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  moduleId: text('module_id').notNull().references(() => modules.id),
}, table => [
  unique('session_modules_pair_unq').on(table.sessionId, table.moduleId),
])

// No WAITLISTED: a place is derived from signed_up_at order against capacity,
// so two simultaneous sign-ups cannot both win the last one (ADR-0013).
export const ATTENDEE_STATUSES = ['SIGNED_UP', 'CANCELLED', 'ATTENDED', 'ABSENT'] as const

/**
 * One row per person per session, carrying both intent and attendance: two
 * tables would have to agree about the same person (ADR-0013).
 */
export const sessionAttendees = sqliteTable('session_attendees', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id),

  // ATTENDED by default, for the same backfill and fail-safe reasons as
  // sessions.status: a row that forgot to say is one that was there.
  status: text('status', { enum: ATTENDEE_STATUSES }).notNull().default('ATTENDED'),
  // The waitlist ordering, and null for anyone logged rather than signed up.
  // Ties break on id, so the order is total.
  signedUpAt: integer('signed_up_at', { mode: 'timestamp_ms' }),
  source: text('source', { enum: ['SELF', 'LEAD'] }).notNull().default('LEAD'),

  markedAt: integer('marked_at', { mode: 'timestamp_ms' }),
  markedByUserId: text('marked_by_user_id').references(() => users.id),
}, table => [
  unique('session_attendees_pair_unq').on(table.sessionId, table.userId),
  index('session_attendees_user_idx').on(table.userId),
  index('session_attendees_status_idx').on(table.sessionId, table.status),
])

export const REQUEST_STATUSES = ['OPEN', 'SCHEDULED', 'WITHDRAWN', 'DECLINED'] as const

/**
 * A demand signal, and nothing more: no queue position and no promise.
 * Nothing on a timer ever resolves one. docs/scheduling-design.md §4
 */
export const moduleRequests = sqliteTable('module_requests', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  userId: text('user_id').notNull().references(() => users.id),
  moduleId: text('module_id').notNull().references(() => modules.id),
  note: text('note'), // why they want it; scrub list

  status: text('status', { enum: REQUEST_STATUSES }).notNull().default('OPEN'),
  resolvedSessionId: text('resolved_session_id').references(() => sessions.id),
  resolvedAt: integer('resolved_at', { mode: 'timestamp_ms' }),
  resolvedBy: text('resolved_by').references(() => users.id),
  declineReason: text('decline_reason'), // shown to the requester; scrub list

  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
}, table => [
  // One open request per person per module, held here rather than in a handler.
  uniqueIndex('module_requests_open_unq').on(table.userId, table.moduleId)
    .where(sql`status = 'OPEN'`),
  index('module_requests_module_idx').on(table.moduleId, table.status),
  index('module_requests_user_idx').on(table.userId),
])

export const moduleRequestsRelations = relations(moduleRequests, ({ one }) => ({
  user: one(users, { fields: [moduleRequests.userId], references: [users.id] }),
  module: one(modules, { fields: [moduleRequests.moduleId], references: [modules.id] }),
}))

/**
 * Append-only (ADR-0008); `expires_at` is stamped once at creation and never
 * recomputed (ADR-0002). Validity is derived. docs/records-and-expiry.md
 */
export const records = sqliteTable('records', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  userId: text('user_id').notNull().references(() => users.id),
  moduleId: text('module_id').notNull().references(() => modules.id),

  awardedAt: text('awarded_at').notNull(), // ISO date: when training happened
  expiresAt: text('expires_at'), // ISO date; NULL = never expires
  // Set when the date came from a certificate or a signer rather than policy.
  // The recalculation skips these, and it is what makes NULL readable (ADR-0012).
  expiryOverridden: integer('expiry_overridden', { mode: 'boolean' }).notNull().default(false),

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
  // One live award per person per module per session: the DELIVERED guard is a
  // read, so this is what stops two phones awarding the same training twice.
  uniqueIndex('records_session_award_unq').on(table.sessionId, table.userId, table.moduleId)
    .where(sql`session_id is not null and revoked_at is null`),
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
