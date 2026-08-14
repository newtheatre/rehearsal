# API Reference

Base URL: `https://training.newtheatre.org.uk/api/v1`. Read-only, JSON, server-to-server. Errors: `{ statusCode, statusMessage }` — no internal detail.

> **Status:** the `/api/v1` surface below lands in **Phase 4**. Phase 1 ships `/api/health` plus the session-authenticated internal routes the pages use (`/api/modules`, `/api/departments`) — those are *not* part of the versioned consumer contract and may change without notice.

**Auth:** `Authorization: Bearer nnt_trn_…` — per-consumer tokens ([operations.md](operations.md#service-tokens)), SHA-256-hashed at rest, constant-time compared, scope `read`. 401 missing/unknown token; 403 scope mismatch. `last_used_at` updated per request.

**Caching:** every response `Cache-Control: private, max-age=300`. Consumers must treat answers as advisory-fresh (≤5 min stale) — see [consuming-the-api.md](consuming-the-api.md#freshness).

**Payload rule:** user ids and names only. **Never emails** (CLAUDE.md invariant 8). Consumers join on canonical ids against their own mirrors.

## Endpoints

### `GET /modules`

Query: `status=ACTIVE` (default) | `all` (includes DRAFT/RETIRED — for admin tooling, not gating).

→ `[{ id, department, kind, name, expiry_mode, expiry_months, safety_critical, status }]`

### `GET /users/:id/records`

→ `{ userId, records: [{ module, kind, awardedAt, expiresAt, state, source }] }` where `state` ∈ `VALID | EXPIRING | EXPIRED` per [records-and-expiry.md](records-and-expiry.md). Current records only (superseded and revoked excluded). BRIEF entries carry `lastAttended` instead of `expiresAt`/`state`. 404 unknown user.

### `GET /records?module=TECH-112&state=VALID`

→ `{ module, users: [{ id, name, state, expiresAt }] }` — who currently holds X (find-a-supervisor, rota UI badges). `state` filter optional; default VALID+EXPIRING. 404 unknown module.

### `GET /eligibility/:key?userId=<id>` <a name="eligibility"></a>

→ `{ key, userId, eligible: boolean, missing: [moduleId], expiring: [{ moduleId, expiresAt }] }`

### `GET /eligibility/:key`

→ `{ key, userIds: [...] }` — everyone currently eligible (list form, for pre-filtering UIs). 404 unknown key.

**Rule evaluation:** `requires` JSON has `allOf` (every module must be VALID/EXPIRING) and `anyOf` (at least one, if the array is non-empty). Rules are data, edited in `/admin`, audit-logged. **This system answers; consumers enforce** ([ADR-0006](decisions/0006-eligibility-rules-as-data.md)) — the rota's DM restriction lives in Proscenium behind its `isDMEligible()` seam, pointed at this endpoint.

### `GET /api/health` — public

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
| `PUT /api/modules/:id` | lead (own dept) or admin | update incl. status transitions and prerequisites; audit-logged |
| `GET /api/people` | session | directory with per-person valid/expiring/expired counts and certifications |
| `GET /api/people/:id` | session | one person's records; revoked history and actions for leads/admins |
| `POST /api/people/:id/signoff` | lead (module's dept) or admin | certification sign-off; **422 with the gaps named** if prerequisites are unmet |
| `POST /api/people/:id/external` | lead (module's dept) or admin | external certificate; its own expiry wins over module config |
| `POST /api/records/:id/revoke` | admin | revoke with a mandatory reason; idempotent |
| `GET /api/sessions` | session | delivery log, newest first |
| `POST /api/sessions/check` | trainer | dry run: the exact records that would be created, plus warnings |
| `POST /api/sessions` | trainer | log a session; creates records atomically |
| `GET /api/sessions/:id` | session | one session; `canEdit` reflects owner + edit window |
| `PUT /api/sessions/:id` | trainer (own session) or admin | re-derive records inside the edit window |
| `POST /api/attendees/lookup` | trainer | resolve an email to a canonical id, creating a shadow account if needed |
| `GET /api/admin/config` | admin | operator-tunable values, with defaults and whether each is stored |
| `PUT /api/admin/config` | admin | change one value; per-key validation; audit-logged |
| `GET /api/admin/expiry-preview` | admin | what the next sweep would do; optional `asOf` date; sends and records nothing |
| `GET /api/admin/notifications` | admin | what has actually been sent |
| `POST /api/admin/recalculate` | admin | preview an expiry recalculation, or apply it by echoing the change count |

**Session-flow status codes.** `POST /api/sessions` answers `409` when attendees are missing
ordinary prerequisites (retry with `acknowledgeWarnings: true`), and `422` when they are
missing prerequisites for a **safety-critical** module — which no acknowledgement overrides.
`POST /api/people/:id/signoff` answers `422` for any unmet prerequisite; certification
sign-off has no override at all.

## Inbound GDPR hooks (called by the auth service)

Per the estate hook pattern (stage-door docs/api-reference.md §app-hooks), authenticated by this app's service token:

| Hook | Behaviour here |
|---|---|
| `POST /api/_hooks/auth/export` | `{ userId }` → this app's personal data: mirror row, records (with modules/dates/sources), sessions attended/delivered |
| `POST /api/_hooks/auth/anonymise` | Rewrite mirror row to anonymised values. **Records survive**, keyed to the anonymised id — training/safety history is retained as anonymous rows, same stance as bookings ([gdpr-retention.md](gdpr-retention.md)). Idempotent. |
| `POST /api/_hooks/auth/last-activity` | `{ userIds }` → latest of: last record awarded, last session attended/delivered, per user |
| `POST /api/_hooks/auth/merge` | `{ fromUserId, toUserId, dryRun? }` → re-point every user-referencing column (records `user_id`/`granted_by`/`revoked_by`, session `trainer_user_id`/`created_by`, attendees, leads) onto `toUserId`, delete the losing mirror row, return `{ ok, notMirrored, counts }`. Idempotent (stage-door ADR-0015). |

## Versioning

Path-versioned. Additive changes land in `/v1`; breaking changes ship as `/v2` alongside `/v1` for at least a term, with consumer owners notified. Update [consuming-the-api.md](consuming-the-api.md)'s consumer table when anyone joins or migrates.
