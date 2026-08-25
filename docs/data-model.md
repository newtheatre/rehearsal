# Data Model

D1 database `training`, Drizzle ORM, SQLite dialect. Schema in `server/db/schema/`; migrations generated (`bun run db:generate`) then hand-reviewed, D1 is SQLite: no `ALTER COLUMN`, column changes are table rebuilds.

Module ids are the human ids (`TECH-111`, `LD-CERT`), they are the subcommittee's published scheme and appear in URLs, emails, and API payloads. User ids are canonical auth ids (CLAUDE.md invariant 7). Everything else: `nanoid()` text PKs.

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
| `id` text PK | `DEPT-LCT` or `XX-CERT`: the catalogue scheme |
| `department` FK not null | |
| `kind` text not null | `MODULE` \| `CERTIFICATION` \| `BRIEF` ([ADR-0003](decisions/0003-certifications-as-modules.md)). **Fixed once the module has an unrevoked record**: validity is read off the live module row, so a flip rewrites every record already awarded. `PUT /api/modules/:id` answers 409; retire the module and create a new one instead |
| `name` · `description` text | Member-visible |
| `notes` text | Lead/admin-visible only (subcommittee working notes) |
| `materials_url` text null | Drive doc/presentation/folder link; `https://` validated, nothing more |
| `expiry_mode` text not null default `NONE` | `NONE` \| `MONTHS` \| `ACADEMIC_YEAR` |
| `expiry_months` integer null | Required iff mode = `MONTHS` |
| `allows_external` integer not null default 0 | Whether training done elsewhere may be recorded against this module. Always 0 for a `BRIEF`, cleared by `applyKindRules`. **Opt-in**: `POST /api/people/:id/external` refuses anything without it |
| `external_evidence` text null | What the lead should accept, for example "FAW or EFAW certificate". Shown when recording; what was actually presented goes in `records.external_ref` |
| `safety_critical` integer not null default 0 | Drives supervision copy + hard prerequisite blocks in the session flow |
| `signoff_required` integer not null default 0 | 1 for certifications |
| `grants_supervisor` / `grants_trainer` integer default 0 | Cert consequences ([records-and-expiry.md](records-and-expiry.md#kinds)). Turning either **on** is refused once the module has an unrevoked record, for the same reason as `kind`: standing is derived at request time, so it would confer itself on every existing holder. Turning one off narrows and is allowed |
| `status` text not null default `DRAFT` | `DRAFT` (leads/admins only) \| `ACTIVE` \| `RETIRED` (kept for history, not offerable) |
| `sort` · `created_at` · `updated_at` | |

### `module_prerequisites` / `legacy_module_map`

`module_prerequisites`: `module_id` FK · `requires_module_id` FK, unique pair. Advisory at session time, hard at sign-off.

`legacy_module_map`: `module_id` FK · `legacy_code` text (e.g. `1.06`), unique pair. Seeded from the spreadsheet's *Old Module(s)* column; read only by the import ([migration.md](migration.md)); no runtime behaviour.

### `users`

Thin mirror: `id` text PK (canonical auth id) · `email` unique · `name` · `is_training_admin` · `anonymised_at` null · `merged_into` FK null · `updated_at`. Upserted by `ensureLocalUser` in the auth middleware, which skips any row with `anonymised_at` **or** `merged_into` set, so neither an erasure nor a merge can be undone by a still-valid session cookie. Email is for pickers and notifications only: never exposed via the API.

`merged_into` is the tombstone the merge hook leaves in place of a delete ([ADR-0015](decisions/0015-a-merged-mirror-row-is-tombstoned.md)): the row keeps the losing id so nothing can resurrect it, and its email and name are scrubbed because the person's identity now lives on the winning row. **Every query that lists people must exclude tombstoned rows**, as `GET /api/directory`, `GET /api/people`, `ensureKnownUser`, `addressableUsers`, `POST /api/admin/leads` and the expiry sweep do. Rows here are never deleted.

`is_training_admin` is a **derived cache** of the auth-service role, refreshed on every upsert. It exists solely so the expiry cron can address the monthly digest: a cron has no session to read roles from. Never gate access on it; the session is the authority.

Nothing here is told when a role is revoked, so the flag is trusted only while `updated_at` is inside `site_config.admin_cache_days` (default 90). A former officer whose role was removed and who stops signing in therefore drops out of the unscoped digest, and out of the dry-run sweep report, rather than receiving membership-wide personal data indefinitely. Both lists come from `freshAdmins` in `server/utils/expiryPlan.ts`, deliberately one implementation. An admin who has never signed in here has no row and so gets no digest either. Making revocation immediate would need the auth service to call a role-change hook, which does not exist yet.

### `sessions` / `session_modules` / `session_attendees`

A scheduled session and a delivered one are the **same row** ([ADR-0013](decisions/0013-a-scheduled-session-is-the-same-row.md)); the design is [scheduling-design.md](scheduling-design.md).

`sessions`: `id` · `held_on` (ISO date, the training date) · `trainer_user_id` FK · `location` null · `notes` null · `created_by` FK · timestamps, plus the lifecycle:

| Column | Notes |
|---|---|
| `status` text not null default `DELIVERED` | `PLANNED` \| `OPEN` \| `FULL` \| `DELIVERED` \| `CANCELLED`. **Only `DELIVERED` has records.** The default backfills existing rows and makes a forgetful writer create something finished rather than an unwatched sign-up sheet |
| `starts_at` / `ends_at` null | Wall-clock. `held_on` stays the date the records are stamped from |
| `capacity` integer null | Null is uncapped; capped at 60 in validation ([scheduling-design.md](scheduling-design.md#53-capacity-is-capped-at-60)) |
| `signups_close_at` null | |
| `register_opened_at` null | Stamped on the day. Opens practice windows rather than changing status |
| `delivered_at` null | Stamped when the register is submitted |
| `cancelled_at` null · `cancel_reason` text null | Scrub list |
| `description` text null | Shown to anybody deciding whether to sign up. Scrub list |

`FULL` is a **cached badge** for the schedule list, recomputed on every sign-up and withdrawal. Nothing authoritative reads it: a sign-up decides on the live count, and if the two disagree the count is right.

Junction tables `session_modules` (`session_id` cascade, `module_id`) and `session_attendees` (`session_id` cascade, `user_id`), unique pairs. `session_attendees` also carries:

| Column | Notes |
|---|---|
| `status` text not null default `ATTENDED` | `SIGNED_UP` \| `CANCELLED` \| `ATTENDED` \| `ABSENT`. Same backfill and fail-safe reasoning as `sessions.status` |
| `signed_up_at` null | The waitlist ordering. Null for anybody logged rather than signed up |
| `source` text not null default `LEAD` | `SELF` \| `LEAD` |
| `marked_at` null · `marked_by_user_id` FK null | Who marked the register, and when |

**There is no `WAITLISTED` status.** Whether a `SIGNED_UP` person holds a place is derived from `signed_up_at` order against `capacity`, by one helper in `server/utils/scheduling.ts`. Storing it would let two simultaneous sign-ups both take the last place, and would put "am I in" in two places at once (CLAUDE.md invariant 4).

Delivered sessions are editable by their trainer/admin for 14 days (`site_config.session_edit_window_days`), counted from `delivered_at` and only from `created_at` when there is none, which is the log-after-the-fact path where the two are the same moment. A session scheduled well in advance is the same row, so counting from `created_at` would have expired the window before it was ever taught. Edits re-derive that session's records in one batch. After the window: corrections via revoke + grant. `PUT /api/sessions/:id` refuses a session that has not been delivered, because it has no records to re-derive.

### `module_requests`

`id` · `user_id` FK · `module_id` FK · `note` null (scrub list) · `status` (`OPEN`|`SCHEDULED`|`WITHDRAWN`|`DECLINED`) · `resolved_session_id` FK null · `resolved_at` null · `resolved_by` FK null · `decline_reason` null (scrub list) · `created_at`.

A demand signal, and nothing else: no queue position, no promise, and no effect on who may sign up to anything. **One open request per person per module**, held by a partial unique index (`WHERE status = 'OPEN'`) rather than by a check in the handler, so withdrawing frees them to ask again.

Opening sign-ups on a session marks the matching open requests `SCHEDULED`; a `PLANNED` session resolves nothing, because nobody can see it. Nothing on a timer resolves a request ([scheduling-design.md](scheduling-design.md) §4).

### `records`

| Column | Notes |
|---|---|
| `id` text PK | |
| `user_id` FK not null · `module_id` FK not null | |
| `awarded_at` text (ISO date) not null | When the training happened |
| `expires_at` text null | Stamped at creation: [records-and-expiry.md](records-and-expiry.md) |
| `expiry_overridden` integer not null default 0 | The date was given explicitly rather than derived from policy. The recalculation skips these, and it is what distinguishes an explicit "never expires" from a `NONE` module |
| `source` text not null | `SESSION` \| `SIGNOFF` \| `EXTERNAL` \| `LEGACY` \| `ADMIN` |
| `session_id` FK null | Set iff `SESSION` |
| `granted_by` FK null | Set for `SIGNOFF`/`EXTERNAL`/`ADMIN` |
| `external_ref` text null | e.g. `SU EFAW cert, expires 2028-03-01` |
| `revoked_at` null · `revoked_by` FK null · `revoke_reason` text null | Append-only corrections (CLAUDE.md invariant 2) |
| `created_at` | Data-entry timestamp (vs `awarded_at`) |

Index `(user_id, module_id, awarded_at)`. Never hard-deleted, including by migrations.

**Partial unique index `records_session_award_unq` on `(session_id, user_id, module_id)` where `session_id is not null and revoked_at is null`.** One live award per person per module per session. The `DELIVERED` check in the register handler is a read taken several round trips before the write, so two leads submitting from two phones can both pass it; this index is what actually stops the second delivery, and because a D1 batch is one transaction the loser aborts whole rather than leaving half a set of duplicates. **Partial is load-bearing:** `applySessionEdit` revokes a session's records and re-inserts the same triple in one batch, which a plain unique index would refuse. The revocation is ordered before the re-insert, so the index sees only one live row at a time.

### `practice_targets` / `practice_windows`

Which modules have a sandbox in a consumer app, and who currently has one open ([ADR-0014](decisions/0014-practice-targets-are-data.md), [scheduling-design.md](scheduling-design.md) §7).

`practice_targets`: `key` PK (e.g. `bar-till`, hardcoded by a consumer, so **never rename one**) · `name` · `description` · `consumer` (a label for the admin list, never authorisation) · `module_ids` JSON · `grace_hours` null · `status` (`ACTIVE`|`RETIRED`) · `updated_by` · `updated_at`. Ships **empty**: nothing opens a sandbox until somebody creates a target, which is the safe default.

`practice_windows`: `id` · `user_id` FK · `target_key` FK · `session_id` FK null (null for an ad-hoc grant) · `opened_by` FK · `opens_at` · `expires_at` · `closed_at` null · `closed_by` FK null · `reason` null (scrub list).

Opening a register inserts one window per signed-up attendee per matching `ACTIVE` target. Marking the register closes them, as does cancelling the session, a lead closing one by hand, expiry, and the daily sweep. **A target's `module_ids` is not `eligibility_rules.requires`**: one says what teaching a module lets you practise, the other what you need before you may do a job, and conflating them would open the till to everybody taught the general induction.

### `eligibility_rules`

`key` text PK (e.g. `duty-manager`) · `name` · `description` · `requires` text (JSON: `{"allOf": [...], "anyOf": [...]}`) · `updated_by` FK · `updated_at`. Evaluation: [api-reference.md](api-reference.md#eligibility). Every change audit-logged.

### `service_tokens` / `site_config` / `audit_log` / `notification_log`

`service_tokens`: `id` · `name` unique (consumer app) · `token_hash` (SHA-256) · `scopes` (`read`) · `created_at` · `last_used_at`. Plaintext `nnt_trn_…` shown once at creation.

`site_config`: `key` PK · `value`, `warning_window_days` (60), `academic_year_end` (`08-31`), `session_edit_window_days` (14), `notifications_mode` (`dry-run`|`live`), `admin_cache_days` (90), `session_reminder_days` (1), `register_nag_days` (2), `register_nag_stop_days` (60), `practice_window_grace_hours` (4). Rows are written by the seed, but every read falls back to the same defaults in `shared/utils/configDefaults.ts`, a missing config row must never change safety semantics.

`audit_log`: `id` · `actor_user_id` null (null = cron/import) · `action` · `target` · `detail` JSON · `created_at`. Append-only, with one sanctioned exception: an account merge re-points `actor_user_id` onto the winning id, because a merge asserts the two ids were always one person and the alternative is a trail that reads "Deleted user" for everything they ever signed off ([ADR-0015](decisions/0015-a-merged-mirror-row-is-tombstoned.md)).

`notification_log`: `user_id` · `type` · `record_id`/`module_id` · `session_id` · `sent_at`: idempotency for both crons ([operations.md](operations.md#notifications)). `session_id` is set for `session.reminder`, `session.nag` and `session.promotion`; the nag repeats weekly, so the check is on the most recent row rather than on any row existing. **`session.promotion` is the one type claimed rather than recorded**: it is written by a conditional insert before the email goes out, and the partial unique index `notification_log_promotion_unq` on `(session_id, user_id, type)` is what makes two withdrawals landing together unable to both tell the same person ([scheduling-design.md](scheduling-design.md) §8). **Pruned after 24 months by the daily expiry sweep**, which is what makes the retention in [gdpr-retention.md](gdpr-retention.md) true rather than merely promised; the sweep's own reads are bounded by the same cutoff, and indexes on `(type, sent_at)` and `(sent_at)` serve the digest read and the prune.

## Writing atomically

D1 rejects `BEGIN`, so `db.transaction()` is unusable here even though it type-checks and
works locally: anything that must be all-or-nothing uses `db.batch()` instead
([ADR-0009](decisions/0009-atomic-writes-use-batch-not-transactions.md)). Practical
consequence when adding a multi-row write: build the statement array first and generate any
ids you need in application code, because nothing can be read back mid-batch.

## Schema-change checklist

1. Edit `server/db/schema/*`, `bun run db:generate`, **read the generated SQL** (SQLite rebuilds can drop data).
2. Update this doc in the same PR; record/validity semantics changes also update [records-and-expiry.md](records-and-expiry.md) (+ ADR if breaking).
3. API payload changes → [api-reference.md](api-reference.md) and a heads-up to consumer owners.
4. Apply to production via `wrangler d1 migrations apply` in a quiet window: [operations.md](operations.md#deployments).
