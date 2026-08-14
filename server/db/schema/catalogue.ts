import { sqliteTable, text, integer, index, unique } from 'drizzle-orm/sqlite-core'
import { relations } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { users } from './user'

// The backstage subcommittee's departments. Codes are the DEPT half of the
// DEPT-LCT module scheme and are stable published identifiers.
export const departments = sqliteTable('departments', {
  code: text('code').primaryKey(), // 'NNT','SFTY','TECH','STGE','MGMT','COST','PROD','ADMN','LEAD'
  name: text('name').notNull(),
  sort: integer('sort').notNull().default(0),
})

// Per-department authority (ADR-0005). App data, not auth-service roles, so
// the annual changeover is a row swap rather than nine grants.
export const departmentLeads = sqliteTable('department_leads', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  department: text('department').notNull().references(() => departments.code),
  userId: text('user_id').notNull().references(() => users.id),
  grantedBy: text('granted_by').references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
}, table => [
  unique('department_leads_dept_user_unq').on(table.department, table.userId),
  index('department_leads_user_idx').on(table.userId),
])

// Modules, certifications and briefs share one table (ADR-0003). The human id
// IS the primary key — it is published and members quote it.
export const modules = sqliteTable('modules', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()), // 'TECH-111', 'LD-CERT'
  department: text('department').notNull().references(() => departments.code),
  kind: text('kind', { enum: ['MODULE', 'CERTIFICATION', 'BRIEF'] }).notNull().default('MODULE'),

  name: text('name').notNull(),
  description: text('description'),
  notes: text('notes'), // lead/admin visible only — subcommittee working notes
  materialsUrl: text('materials_url'), // Drive doc/presentation/folder

  // Expiry policy — config, not code (docs/records-and-expiry.md). Read at
  // award time only: changing it never touches existing records (ADR-0002).
  expiryMode: text('expiry_mode', { enum: ['NONE', 'MONTHS', 'ACADEMIC_YEAR'] }).notNull().default('NONE'),
  expiryMonths: integer('expiry_months'), // required iff mode = MONTHS

  safetyCritical: integer('safety_critical', { mode: 'boolean' }).notNull().default(false),
  signoffRequired: integer('signoff_required', { mode: 'boolean' }).notNull().default(false),
  // Cert consequences: supervisor standing (display), trainer standing
  // (unlocks session logging — derived at request time, ADR-0004).
  grantsSupervisor: integer('grants_supervisor', { mode: 'boolean' }).notNull().default(false),
  grantsTrainer: integer('grants_trainer', { mode: 'boolean' }).notNull().default(false),

  // RETIRED modules are kept for history and are not offerable.
  status: text('status', { enum: ['DRAFT', 'ACTIVE', 'RETIRED'] }).notNull().default('DRAFT'),
  sort: integer('sort').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
}, table => [
  index('modules_department_idx').on(table.department),
  index('modules_status_idx').on(table.status),
])

// Advisory at session-logging time (a warning), hard at certification
// sign-off (docs/permissions.md).
export const modulePrerequisites = sqliteTable('module_prerequisites', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  moduleId: text('module_id').notNull().references(() => modules.id, { onDelete: 'cascade' }),
  requiresModuleId: text('requires_module_id').notNull().references(() => modules.id),
}, table => [
  unique('module_prerequisites_pair_unq').on(table.moduleId, table.requiresModuleId),
  index('module_prerequisites_requires_idx').on(table.requiresModuleId),
])

// Seeded from the spreadsheet's "Old Module(s)" column; read only by the
// one-off legacy import (docs/migration.md). No runtime behaviour.
export const legacyModuleMap = sqliteTable('legacy_module_map', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  moduleId: text('module_id').notNull().references(() => modules.id, { onDelete: 'cascade' }),
  legacyCode: text('legacy_code').notNull(), // e.g. '1.06'
}, table => [
  unique('legacy_module_map_pair_unq').on(table.moduleId, table.legacyCode),
])

export const departmentsRelations = relations(departments, ({ many }) => ({
  modules: many(modules),
  leads: many(departmentLeads),
}))

export const modulesRelations = relations(modules, ({ one, many }) => ({
  department: one(departments, {
    fields: [modules.department],
    references: [departments.code],
  }),
  prerequisites: many(modulePrerequisites, { relationName: 'module' }),
  legacyCodes: many(legacyModuleMap),
}))

export const modulePrerequisitesRelations = relations(modulePrerequisites, ({ one }) => ({
  module: one(modules, {
    fields: [modulePrerequisites.moduleId],
    references: [modules.id],
    relationName: 'module',
  }),
  requires: one(modules, {
    fields: [modulePrerequisites.requiresModuleId],
    references: [modules.id],
    relationName: 'requires',
  }),
}))

export const departmentLeadsRelations = relations(departmentLeads, ({ one }) => ({
  department: one(departments, {
    fields: [departmentLeads.department],
    references: [departments.code],
  }),
  user: one(users, {
    fields: [departmentLeads.userId],
    references: [users.id],
  }),
}))
