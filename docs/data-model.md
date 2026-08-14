# Data Model

D1 database `training`, Drizzle ORM, SQLite dialect. Schema in `server/db/schema/`; migrations generated (`bun run db:generate`) then hand-reviewed — D1 is SQLite: no `ALTER COLUMN`, column changes are table rebuilds.

Module ids are the human ids (`TECH-111`, `LD-CERT`) — they are the subcommittee's published scheme and appear in URLs, emails, and API payloads. User ids are canonical auth ids (CLAUDE.md invariant 7). Everything else: `nanoid()` text PKs.

## Tables

### `departments`

| Column | Notes |
|---|---|
| `code` text PK | `NNT`,`SFTY`,`TECH`,`STGE`,`MGMT`,`COST`,`PROD`,`ADMN`,`LEAD` |
| `name` text · `sort` integer | Display |

### `department_leads`

| Column | Notes |
|---|---|
| `department` FK · `user_id` FK · `granted_by` FK · `created_at` | Unique `(department, user_id)`. Grants sign-off + module stewardship for that department ([permissions.md](permissions.md)). Managed in `/admin` by `training:ADMIN`; the annual changeover is row swaps, not auth operations ([ADR-0005](decisions/0005-department-leads-as-data.md)). |

### `modules`

| Column | Notes |
|---|---|
| `id` text PK | `DEPT-LCT` or `XX-CERT` — the catalogue scheme |
| `department` FK not null | |
| `kind` text not null | `MODULE` \| `CERTIFICATION` \| `BRIEF` ([ADR-0003](decisions/0003-certifications-as-modules.md)) |
| `name` · `description` text | Member-visible |
| `notes` text | Lead/admin-visible only (subcommittee working notes) |
| `materials_url` text null | Drive doc/presentation/folder link; `https://` validated, nothing more |
| `expiry_mode` text not null default `NONE` | `NONE` \| `MONTHS` \| `ACADEMIC_YEAR` |
| `expiry_months` integer null | Required iff mode = `MONTHS` |
| `safety_critical` integer not null default 0 | Drives supervision copy + hard prerequisite blocks in the session flow |
| `signoff_required` integer not null default 0 | 1 for certifications |
| `grants_supervisor` / `grants_trainer` integer default 0 | Cert consequences ([records-and-expiry.md](records-and-expiry.md#kinds)) |
| `status` text not null default `DRAFT` | `DRAFT` (leads/admins only) \| `ACTIVE` \| `RETIRED` (kept for history, not offerable) |
| `sort` · `created_at` · `updated_at` | |

### `module_prerequisites` / `legacy_module_map`

`module_prerequisites`: `module_id` FK · `requires_module_id` FK, unique pair. Advisory at session time, hard at sign-off.

`legacy_module_map`: `module_id` FK · `legacy_code` text (e.g. `1.06`), unique pair. Seeded from the spreadsheet's *Old Module(s)* column; read only by the import ([migration.md](migration.md)); no runtime behaviour.

### `users`

Thin mirror: `id` text PK (canonical auth id) · `email` unique · `name` · `is_training_admin` · `updated_at`. Upserted by `ensureLocalUser` in the auth middleware. Email is for pickers and notifications only — never exposed via the API.

`is_training_admin` is a **derived cache** of the auth-service role, refreshed on every upsert. It exists solely so the expiry cron can address the monthly digest — a cron has no session to read roles from. Never gate access on it; the session is the authority and this copy self-heals within the staleness window (the pattern `rooms` uses, sanctioned by stage-door's integrating-an-app guide). An admin who has never signed in here has no row and so gets no digest.

### `sessions` / `session_modules` / `session_attendees`

`sessions`: `id` · `held_on` (ISO date, the training date) · `trainer_user_id` FK · `location` null · `notes` null · `created_by` FK · timestamps. Junction tables `session_modules` (`session_id` cascade, `module_id`) and `session_attendees` (`session_id` cascade, `user_id`), unique pairs. Sessions are editable by their trainer/admin for 14 days (`site_config.session_edit_window_days`); edits re-derive that session's records in a transaction. After the window: corrections via revoke + grant.

### `records`

| Column | Notes |
|---|---|
| `id` text PK | |
| `user_id` FK not null · `module_id` FK not null | |
| `awarded_at` text (ISO date) not null | When the training happened |
| `expires_at` text null | Stamped at creation — [records-and-expiry.md](records-and-expiry.md) |
| `source` text not null | `SESSION` \| `SIGNOFF` \| `EXTERNAL` \| `LEGACY` \| `ADMIN` |
| `session_id` FK null | Set iff `SESSION` |
| `granted_by` FK null | Set for `SIGNOFF`/`EXTERNAL`/`ADMIN` |
| `external_ref` text null | e.g. `SU EFAW cert, expires 2028-03-01` |
| `revoked_at` null · `revoked_by` FK null · `revoke_reason` text null | Append-only corrections (CLAUDE.md invariant 2) |
| `created_at` | Data-entry timestamp (vs `awarded_at`) |

Index `(user_id, module_id, awarded_at)`. Never hard-deleted, including by migrations.

### `eligibility_rules`

`key` text PK (e.g. `duty-manager`) · `name` · `description` · `requires` text (JSON: `{"allOf": [...], "anyOf": [...]}`) · `updated_by` FK · `updated_at`. Evaluation: [api-reference.md](api-reference.md#eligibility). Every change audit-logged.

### `service_tokens` / `site_config` / `audit_log` / `notification_log`

`service_tokens`: `id` · `name` unique (consumer app) · `token_hash` (SHA-256) · `scopes` (`read`) · `created_at` · `last_used_at`. Plaintext `nnt_trn_…` shown once at creation.

`site_config`: `key` PK · `value` — `warning_window_days` (60), `academic_year_end` (`09-30`), `session_edit_window_days` (14), `notifications_mode` (`dry-run`|`live`). Rows are written by the seed, but every read falls back to the same defaults in `shared/utils/configDefaults.ts` — a missing config row must never change safety semantics.

`audit_log`: `id` · `actor_user_id` null (null = cron/import) · `action` · `target` · `detail` JSON · `created_at`. Append-only.

`notification_log`: `user_id` · `type` · `record_id`/`module_id` · `sent_at` — idempotency for the cron ([operations.md](operations.md#notifications)).

## Writing atomically

D1 rejects `BEGIN`, so `db.transaction()` is unusable here even though it type-checks and
works locally — anything that must be all-or-nothing uses `db.batch()` instead
([ADR-0009](decisions/0009-atomic-writes-use-batch-not-transactions.md)). Practical
consequence when adding a multi-row write: build the statement array first and generate any
ids you need in application code, because nothing can be read back mid-batch.

## Schema-change checklist

1. Edit `server/db/schema/*`, `bun run db:generate`, **read the generated SQL** (SQLite rebuilds can drop data).
2. Update this doc in the same PR; record/validity semantics changes also update [records-and-expiry.md](records-and-expiry.md) (+ ADR if breaking).
3. API payload changes → [api-reference.md](api-reference.md) and a heads-up to consumer owners.
4. Apply to production via `wrangler d1 migrations apply` in a quiet window — [operations.md](operations.md#deployments).
