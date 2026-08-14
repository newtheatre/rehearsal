# ADR-0008: Records are revoked, never deleted

**Status:** Accepted · **Date:** 2026-08-10 · **Deciders:** Matt Adcock (ITM 26/27)

## Context

Records will sometimes be wrong: mis-logged attendee, over-generous sign-off, a certification granted in error. These records gate safety-relevant activity, so corrections must be possible — but a training system whose history can be silently rewritten cannot serve as evidence of who was believed trained when.

## Decision

`records` is append-only. Corrections are revocations — `revoked_at`, `revoked_by`, mandatory `revoke_reason` — plus new grants where warranted. Revoked records disappear from all gating and current views but remain in per-person history (lead/admin visible) and exports. No handler, migration, or script hard-deletes a record; bulk operations (bad import) are bulk *revocations*. GDPR erasure anonymises the person, not the records ([gdpr-retention.md](../gdpr-retention.md)).

## Alternatives considered

- **Hard delete with audit-log entry** — lost: the audit log records *that* something was deleted, not the full evidence chain of what the system believed and when; and deletion invites "just tidy it up" habits that safety records can't afford.
- **Soft-delete flag without reason** — lost: a revocation without a reason is indistinguishable from a mistake; the reason field is what makes history reviewable.

## Consequences

Good: any past state of "who did we believe was trained?" is reconstructible — which is what an incident review needs; corrections are themselves accountable acts. Bad: the table only grows (fine: this is a student theatre, not telemetry); queries filter on `revoked_at IS NULL` everywhere (encapsulated in the current-record query helper, tested).
