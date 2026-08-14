import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

/**
 * Thin local mirror of the canonical identity held by the auth service
 * (stage-door docs/integrating-an-app.md §mirror). Ids are the auth
 * service's canonical ids and are never minted here (CLAUDE.md invariant 7):
 * records, sessions and leads all FK against them.
 *
 * Email exists for attendee pickers and notification sending only — it is
 * never exposed through the read API (invariant 8).
 */
export const users = sqliteTable('users', {
  id: text('id').primaryKey(), // canonical auth id — never generated locally
  // .unique() already creates the index the attendee picker searches on.
  email: text('email').notNull().unique(),
  name: text('name').notNull(),

  /**
   * Derived cache of `training:ADMIN`, refreshed from the session on every
   * mirror upsert. It exists ONLY so the expiry cron can address the monthly
   * digest to the TM and ITM — a cron has no session to read roles from.
   *
   * Never gate access on this (stage-door integrating-an-app.md §4): the
   * session is the authority, and this copy self-heals within the staleness
   * window. Same pattern as rooms' `is_rooms_admin`.
   *
   * Consequence worth knowing: an admin who has never signed in to *this*
   * app has no mirror row yet and so gets no digest until they do.
   */
  isTrainingAdmin: integer('is_training_admin', { mode: 'boolean' }).notNull().default(false),

  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
})
