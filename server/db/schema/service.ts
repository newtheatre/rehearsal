import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { nanoid } from 'nanoid'
import { users } from './user'

/**
 * Named eligibility rules (ADR-0006) — data, not code. This app answers;
 * consumers enforce. `requires` shape: docs/data-model.md
 */
export const eligibilityRules = sqliteTable('eligibility_rules', {
  key: text('key').primaryKey(), // 'duty-manager' — never rename; consumers hardcode it
  name: text('name').notNull(),
  description: text('description'),
  requires: text('requires').notNull().default('{"allOf":[],"anyOf":[]}'),
  updatedBy: text('updated_by').references(() => users.id),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
})

/**
 * Per-consumer bearer tokens. Plaintext is shown once at creation; only the
 * SHA-256 is stored, compared constant-time.
 */
export const serviceTokens = sqliteTable('service_tokens', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  name: text('name').notNull().unique(), // consumer app, e.g. 'proscenium-rota'
  tokenHash: text('token_hash').notNull(),
  scopes: text('scopes').notNull().default('read'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
})

/**
 * Operator-tunable values that must not require a deploy. Keys, defaults and
 * meanings: docs/data-model.md#site_config
 */
export const siteConfig = sqliteTable('site_config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
})
