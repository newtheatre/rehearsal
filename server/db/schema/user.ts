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
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
})
