# API Reference

Base URL: `https://training.newtheatre.org.uk/api/v1`. Read-only, JSON, server-to-server. Errors: `{ statusCode, statusMessage }`: no internal detail.

**Auth:** `Authorization: Bearer nnt_trn_…`: per-consumer tokens ([operations.md](operations.md#service-tokens)), SHA-256-hashed at rest, constant-time compared, scope `read`. 401 missing/unknown token; 403 scope mismatch. `last_used_at` updated per request.

**Caching:** every response `Cache-Control: private, max-age=300`. Consumers must treat answers as advisory-fresh (≤5 min stale): see [consuming-the-api.md](consuming-the-api.md#freshness).

**Payload rule:** user ids and names only. **Never emails** (CLAUDE.md invariant 8). Consumers join on canonical ids against their own mirrors.

## Endpoints

Paths in this section are relative to the base URL above: `GET /modules` is
`GET /api/v1/modules`. The one exception is flagged where it appears.

### `GET /modules`

Query: `status=ACTIVE` (default) | `all` (includes DRAFT/RETIRED, for admin tooling, not gating).

→ `[{ id, department, kind, name, expiry_mode, expiry_months, safety_critical, status }]`

### `GET /users/:id/records`

→ `{ userId, records: [{ module, kind, awardedAt, expiresAt, state, source }] }` where `state` ∈ `VALID | EXPIRING | EXPIRED` per [records-and-expiry.md](records-and-expiry.md). Current records only (superseded and revoked excluded). BRIEF entries carry `lastAttended` instead of `expiresAt`/`state`. 404 unknown user.

### `GET /records?module=TECH-112&state=VALID`

→ `{ module, users: [{ id, name, state, expiresAt }] }`: who currently holds X (find-a-supervisor, rota UI badges). `state` filter optional; default VALID+EXPIRING. 404 unknown module.

### `GET /eligibility/:key?userId=<id>` <a name="eligibility"></a>

→ `{ key, userId, eligible: boolean, missing: [moduleId], expiring: [{ moduleId, expiresAt }] }`

> **`GET /v1/modules` returns a bare array, and stays that way.** The estate convention is that list endpoints return a pagination envelope. This one
> predates that and is a published contract, so changing its shape needs a `/v2`. It is bounded by the catalogue rather than by membership or
> records (57 modules today, and it grows only when the subcommittee adds one), so it does not carry the risk the rule exists to prevent.

### `GET /eligibility/:key`

→ `{ key, userIds: [...] }`: everyone currently eligible (list form, for pre-filtering UIs). 404 unknown key.

**Rule evaluation:** `requires` JSON has `allOf` (every module must be VALID/EXPIRING) and `anyOf` (at least one, if the array is non-empty). A rule that cannot be parsed, or that requires nothing at all, is answered with **503** rather than treated as satisfied: a consumer authorises on these answers, so the direction of failure is towards leaving access alone. Rules are data, edited in `/admin`, audit-logged. **This system answers; consumers enforce** ([ADR-0006](decisions/0006-eligibility-rules-as-data.md)): the rota's DM restriction lives in Proscenium behind its `isDMEligible()` seam, pointed at this endpoint.

### `GET /practice/:key?userId=<id>` <a name="practice"></a>

→ `{ key, userId, active: boolean, expiresAt: string | null, sessionId: string | null }`

Is this person being taught this **right now**? For consumer apps with a training mode: a sandbox reachable only while somebody is actually being taught the thing ([ADR-0014](decisions/0014-practice-targets-are-data.md), [scheduling-design.md](scheduling-design.md) §7).

`:key` is a **practice target**, not an eligibility rule. Different namespace, different table, deliberately: the `bar` rule *requires* the general induction, and teaching the general induction must not open the till.

**This endpoint alone answers `Cache-Control: no-store`**, breaking the five-minute rule above. A window closes the moment a lead marks the register, and a cached `true` would keep a consumer's sandbox open after the lesson ended, which is exactly the reset the feature promises. Consumers ask when a run starts and when it resumes, not per request, and `expiresAt` tells them when to stop.

404 on an unknown or retired key, and on an unknown user. A 404 is a configuration break across two repos and must be surfaced loudly rather than read as "not practising". Consumers are asked to **fail closed** here, which is the opposite of the direction the rota chose for eligibility and is argued in [consuming-the-api.md](consuming-the-api.md#practice).

### `GET /api/health`: public, **not** under `/api/v1`

`{ ok: true, version }`.

## Internal routes (session-authenticated)

Used by this app's own pages; not a consumer contract, no version guarantee.

| Route | Guard | Returns |
|---|---|---|
| `GET /api/me` | session | the caller's abilities (admin, lead departments, trainer standing) |
| `GET /api/me/records` | session | own records, expiring/expired splits, and prerequisite-met suggestions |
| `GET /api/departments` | session | departments with module counts (visible-to-caller counts only) |
| `GET /api/modules` | session | catalogue list; `DRAFT` included only for leads/admins |
| `GET /api/modules/:id` | session | module detail incl. prerequisites and dependents; `notes` only for leads/admins |
| `POST /api/modules` | lead (own dept) or admin | create; Zod-validated; audit-logged |
| `PUT /api/modules/:id` | lead (own dept) or admin | update incl. status transitions and prerequisites; audit-logged. **409** on changing `kind`, or turning on `grants_trainer`/`grants_supervisor`, once the module has an unrevoked record: those fields are read live, so the change would rewrite records already awarded ([ADR-0002](decisions/0002-expiry-stamped-at-award.md)) |
| `GET /api/people` | session | directory with per-person valid/expiring/expired counts and certifications. Paged: `limit` (default 50, max 100) with a keyset cursor `(afterName, afterId)`; `q` and `module` filter in SQL. Returns `{ people, hasMore }` |
| `GET /api/directory` | session | id and name only, for the attendee and lead pickers. No record aggregation, so it can return the whole membership (`limit` default 500) |
| `GET /api/people/:id` | session | one person's records; revoked history and actions for leads/admins |
| `POST /api/people/:id/signoff` | lead (module's dept) or admin | certification sign-off; **422 with the gaps named** if prerequisites are unmet. Optional `expiresAt` overrides module policy (after the award, within ten years, refused when the module never expires). `neverExpires: true` needs `record.manage` and is **API only on purpose**: it is break-glass against a lockout, not a routine choice, so no UI offers it |
| `POST /api/people/:id/external` | lead (module's dept) or admin | external certificate; its own expiry wins over module config. 400 unless the module sets `allows_external` |
| `POST /api/records/:id/revoke` | admin | revoke with a mandatory reason; idempotent |
| `GET /api/sessions` | session | delivery log, newest first. **`DELIVERED` only**: a scheduled session is not in the log until its register is submitted. Paged: `limit` (default 50, max 100) with a keyset cursor `(beforeHeldOn, beforeId)`; `held_on` is a date, so the id breaks ties. Returns `{ sessions, hasMore }`. Column allow-listed: `id`, `heldOn`, `status`, `startsAt`, `endsAt`, `location`, `capacity`, `trainerUserId`, `trainerName`, `deliveredAt`, `moduleIds`, `attendeeCount`. **`notes` is not in it**: any member may read this list, and the trainer's working notes are for the steward only, as on `GET /api/sessions/:id` |
| `POST /api/sessions/check` | trainer | dry run: the exact records that would be created, plus warnings |
| `POST /api/sessions` | trainer | log a session already taught; creates records atomically |
| `GET /api/sessions/:id` | session | one session, scheduled or delivered. `attendees` is `null` for anybody who may not steward it; `mine` says where the caller stands |
| `PUT /api/sessions/:id` | trainer (own session) or admin | re-derive records inside the edit window, measured from `delivered_at` (`created_at` only when a session was logged rather than scheduled). **409 unless the session is `DELIVERED`**: there are no records to re-derive otherwise |
| `GET /api/sessions/upcoming` | session | the schedule, soonest first. `PLANNED` sessions are visible only to trainers and leads |
| `POST /api/sessions/schedule` | trainer | put a session in the diary. **Creates no records.** `openNow: true` skips `PLANNED`. Times are `startsTime`/`endsTime` as `HH:MM` **wall-clock in Europe/London**, never instants: the server composes them with `heldOn`, because a browser would anchor them to whatever the device says |
| `PUT /api/sessions/:id/schedule` | steward | amend a session that has not been taught; 409 once it is `DELIVERED` or `CANCELLED`. Raising capacity emails whoever it moved into a place and recomputes the FULL badge; returns `promoted`. Moving `heldOn` recomposes the stored instants from the same wall-clock times, so a session keeps its time of day when its date moves |
| `POST /api/sessions/:id/open` | steward | open sign-ups; 409 unless the session is `PLANNED` |
| `POST /api/sessions/:id/cancel` | steward | cancel with a mandatory reason, and email everyone signed up. Creates and touches no records |
| `POST /api/sessions/:id/signup` | session | take a place, or join the waitlist. Returns `{ hasPlace, waitlistPosition, warnings }` |
| `DELETE /api/sessions/:id/signup` | session | withdraw. Allowed until the session is delivered or cancelled, including while the register is open. Returns how many people that moved into a place |
| `POST /api/sessions/:id/attendees` | steward | add a walk-in. Bypasses the sign-up prerequisite gate on purpose; the register-time check still applies |
| `POST /api/sessions/:id/register/open` | steward | start taking the register. Idempotent, and **closes sign-ups**. 409 while `held_on` is still in the future: opening early would open everybody's practice windows early |
| `GET /api/sessions/:id/register` | steward | who to mark off, in sign-up order, waitlist marked, plus `practiceTargets`: the sandboxes this session's modules unlock, or empty when they unlock none |
| `POST /api/sessions/:id/register` | steward | **mark it, which creates the records.** 409 if already marked, and 409 while `held_on` is still in the future: records are stamped with `held_on`, and a record dated ahead of today is valid to every gate. Move the date to today first |
| `GET /api/module-requests` | session | your own requests, paged (`limit` default 50) and returned with `hasMore`, plus the demand board if you lead a department |
| `POST /api/module-requests` | session | ask for a module to be taught. 409 if you already have one open, 400 if it is not `ACTIVE` |
| `DELETE /api/module-requests/:id` | session (own) | withdraw, which frees you to ask again later |
| `POST /api/module-requests/:id/decline` | lead (module's dept) or admin | reply with a reason, which the requester is shown |
| `POST /api/attendees/lookup` | trainer | resolve an email to a canonical id, creating a shadow account if needed |
| `GET /api/admin/config` | admin | operator-tunable values, with defaults and whether each is stored |
| `PUT /api/admin/config` | admin | change one value; per-key validation; audit-logged. `academic_year_end` is `MM-DD`, month first, and must be a real calendar day: `31-08`, `09-31` and `02-29` are refused with 400 |
| `GET /api/admin/expiry-preview` | admin | what the next sweep would do; optional `asOf` date; sends and records nothing |
| `GET /api/admin/notifications` | admin | what has actually been sent |
| `POST /api/admin/recalculate` | admin | preview an expiry recalculation, or apply it by echoing the change count. Returns `{ changes, unchanged, skippedOverridden }`; records whose expiry was set explicitly are never recomputed |
| `GET /api/admin/service-tokens` | admin | issued consumer tokens (never the tokens themselves) |
| `POST /api/admin/service-tokens` | admin | issue one; the plaintext is in the response and nowhere else |
| `DELETE /api/admin/service-tokens/:id` | admin | revoke; the consumer starts getting 401s immediately |
| `GET /api/admin/leads` | admin | who leads what, grouped by department **including the empty ones**: "COST has no lead" is the useful answer at handover |
| `POST /api/admin/leads` | admin | make someone a lead of a department; audit-logged ([ADR-0005](decisions/0005-department-leads-as-data.md)) |
| `DELETE /api/admin/leads/:id` | admin | stand a lead down; audit-logged |
| `GET /api/admin/audit` | admin | the audit trail, filtered and paged. Paging is a keyset cursor on `(before, beforeId)`, both taken from the last row of the previous page; `created_at` alone is not unique. Read-only: the table is append-only and nothing writes to it here. A null actor is the cron or an import and reads as "system" |
| `GET /api/admin/eligibility-rules` | admin | rules and what they require; `requires` is `null` for a rule stored in an unparseable form |
| `PUT /api/admin/eligibility-rules` | admin | create or update a rule; audit-logged with before and after |
| `GET /api/admin/practice-targets` | admin | targets, and every window open right now |
| `PUT /api/admin/practice-targets` | admin | create or update a target; module ids validated; audit-logged |
| `POST /api/practice-windows` | trainer or lead | open a sandbox by hand for ad-hoc coaching; a reason is required |
| `DELETE /api/practice-windows/:id` | trainer or lead | shut one early |

**"Steward"** above means the trainer running the session, whoever created it, any department
lead, or an admin.

**Session-flow status codes.** `POST /api/sessions` answers `409` when attendees are missing
ordinary prerequisites (retry with `acknowledgeWarnings: true`), and `422` when they are
missing prerequisites for a **safety-critical** module, which no acknowledgement overrides.
`POST /api/people/:id/signoff` answers `422` for any unmet prerequisite; certification
sign-off has no override at all.

**Sign-up never fails for being full.** Past capacity `POST /api/sessions/:id/signup` returns
`hasPlace: false` with a `waitlistPosition`, and `201` either way. It answers `409` for a session
that is not open (planned, cancelled, delivered, past, sign-ups closed, register already open, or
already signed up) and `422` when the member is missing a prerequisite for a **safety-critical**
module. Ordinary prerequisite gaps come back as `warnings` alongside a successful sign-up rather
than blocking it: the gap may well be closed by the time the session runs.

A place is **derived** from sign-up order against capacity, never stored, so `hasPlace` can change
without anybody being written to ([ADR-0013](decisions/0013-a-scheduled-session-is-the-same-row.md)).

**Marking the register is the only thing that awards a scheduled session's records.** `POST
/api/sessions/:id/register` takes a **complete** set of `marks` and creates records for the present
cohort only. The marks must match the register in both directions: `409` if a mark names somebody no
longer signed up, and `409` naming who was missed if a register entry has no mark, because a partial
submission would otherwise deliver the session and strand that person with no record and no email. It
answers `409` with `requiresAllAbsentAcknowledgement` when nobody is marked present, until
`acknowledgeAllAbsent: true`, because one tap on an untouched register would otherwise award
nobody and send everybody a no-show note. It also answers `409` if the register has already been marked (a double tap, a retry, or a second lead
on a second phone must not award the same training twice), `409` if the register exceeds
`MAX_REGISTER` (200) with an instruction to split the session, `422` for a safety-critical
prerequisite gap among the people **present**, and `409` for ordinary gaps until
`acknowledgeWarnings: true`. Prerequisites are checked again here
because somebody can sign up in October and lose one to expiry before the session runs.

Everybody marked absent gets no record and one email. A waitlisted person marked present is awarded
normally: the waitlist decides who to expect, not who was taught.

Whoever asked is emailed when their request is answered, which is the whole
value of asking.

**Requests resolve when a session becomes visible, not when it is created.** Opening sign-ups for a
session (whether at `POST /api/sessions/schedule` with `openNow`, or later at
`POST /api/sessions/:id/open`) marks the matching open requests `SCHEDULED` and links them to it. A
`PLANNED` session answers nobody, because nobody can see it. Nothing on a timer ever resolves a
request: one nobody acts on stays open and keeps appearing on the board, which is the point of it.

## Inbound GDPR hooks (called by the auth service)

Per the estate hook pattern (stage-door docs/api-reference.md §app-hooks), authenticated by this app's service token:

| Hook | Behaviour here |
|---|---|
| `POST /api/_hooks/auth/export` | `{ userId }` → this app's personal data: mirror row, records (with modules/dates/sources), sessions attended/delivered |
| `POST /api/_hooks/auth/anonymise` | Rewrite mirror row to anonymised values. **Records survive**, keyed to the anonymised id: training/safety history is retained as anonymous rows, same stance as bookings ([gdpr-retention.md](gdpr-retention.md)). Idempotent. |
| `POST /api/_hooks/auth/last-activity` | `{ userIds }` → latest of: last record awarded, last session attended/delivered, per user |
| `POST /api/_hooks/auth/merge` | `{ fromUserId, toUserId, dryRun? }` → re-point every user-referencing column onto `toUserId`, delete the losing mirror row, return `{ ok, notMirrored, counts }`. Idempotent (stage-door ADR-0015). **Every column means every column:** records (`user_id`/`granted_by`/`revoked_by`), sessions (`trainer_user_id`/`created_by`), attendees (`user_id`/`marked_by_user_id`), leads, rules, notifications, module requests (`user_id`/`resolved_by`), practice windows (`user_id`/`opened_by`/`closed_by`) and practice targets (`updated_by`). The closing delete is what enforces it: miss one and the whole merge fails on a foreign key, so adding a user-referencing column means adding it here. |
| `GET /api/_hooks/auth/manifest` | This app's declaration: namespace (`training`), the roles it reads, the permissions each carries, and **the eligibility rules it offers**. The auth service polls it and turns the roles into definitions, so adding a role here is what makes it grantable (stage-door ADR-0017). |

`eligibilityRules` in the manifest is read from the `eligibility_rules` table, never written as a
literal: a rule the auth service cannot see is a rule nobody can gate on. `tests/manifest.test.ts`
holds that property.

Permissions are lowercase and dotted (`record.manage`) where roles are uppercase (`ADMIN`), so the
two can never be confused in one string. Only what the auth-service role grants appears here.
Department leadership and trainer standing are app data, not roles, and stay out of the manifest
([permissions.md](permissions.md)).

## Versioning

Path-versioned. Additive changes land in `/v1`; breaking changes ship as `/v2` alongside `/v1` for at least a term, with consumer owners notified. Update [consuming-the-api.md](consuming-the-api.md)'s consumer table when anyone joins or migrates.
