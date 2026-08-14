import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

/**
 * Thin mirror of the canonical identity; ids are never minted here (CLAUDE.md
 * invariant 7). Email is never exposed through the read API (invariant 8).
 */
export const users = sqliteTable('users', {
  id: text('id').primaryKey(), // canonical auth id — never generated locally
  // .unique() already creates the index the attendee picker searches on.
  email: text('email').notNull().unique(),
  name: text('name').notNull(),

  /**
   * A cache for the expiry cron's digest addressing — a cron has no session to
   * read roles from. Never gate access on it; the session is the authority.
   */
  isTrainingAdmin: integer('is_training_admin', { mode: 'boolean' }).notNull().default(false),

  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
})
