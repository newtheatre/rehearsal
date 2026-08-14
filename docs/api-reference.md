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

## Internal routes (Phase 1, session-authenticated)

Used by this app's own pages; not a consumer contract, no version guarantee.

| Route | Guard | Returns |
|---|---|---|
| `GET /api/departments` | session | departments with module counts (visible-to-caller counts only) |
| `GET /api/modules` | session | catalogue list; `DRAFT` included only for leads/admins |
| `GET /api/modules/:id` | session | module detail incl. prerequisites and dependents; `notes` only for leads/admins |
| `POST /api/modules` | lead (own dept) or admin | create; Zod-validated; audit-logged |
| `PUT /api/modules/:id` | lead (own dept) or admin | update incl. status transitions and prerequisites; audit-logged |

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
