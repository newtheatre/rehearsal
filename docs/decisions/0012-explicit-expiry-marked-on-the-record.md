# ADR-0012: An expiry may be set explicitly, and the record says so

**Status:** Accepted · **Date:** 2026-08-20 · **Deciders:** Matt Adcock (ITM 26/27)

## Context

Only `EXTERNAL` records could carry a bespoke expiry, and the recalculation expressed "do not rewrite this" as `source = 'EXTERNAL'`.

Certification sign-off needs the same thing, because an assessor or an awarding body sometimes sets a specific review date that the module's policy does not know about. The moment a `SIGNOFF` row can carry a bespoke date, `source` stops identifying which rows are policy-derived, and the recalculation would silently overwrite a human's deliberate decision.

There is a second, sharper problem. The system can lock itself out. Trainer standing derives from holding a valid `LEAD-CERT`, and only a trainer can log the session that would award one. When the bootstrap certification expires, nobody holds it and nobody can grant it back through the app.

## Decision

`records.expiry_overridden`, boolean, not null, default false. It is set when the creating request supplied an expiry, and always for `EXTERNAL`. The recalculation skips on the marker and reports `skippedOverridden`.

Sign-off accepts an optional `expiresAt`: strictly after the award, at most 120 months out, which is the catalogue's own cap on `expiry_months` so an override cannot express a policy a module is not allowed to have. It is refused when the module's mode is `NONE` or its kind is `BRIEF`.

Session logging cannot set one, enforced in `buildRecordInserts` rather than by convention, because a single expiry cannot describe a users-by-modules fan-out. The guard checks both the source and the fan-out size: the first is the rule, the second is what stays true when a sixth source is added.

**"Never expires" is expressible, and the marker is what makes it readable.** A null `expires_at` with the flag set means "explicitly never"; the same null without it means "policy says never". Because that distinction lives in a separate column rather than in the nullability of a date, no tri-state is needed. The override is passed through the code as `{ expiresAt: string | null }` rather than a bare value, so "absent" and "present but null" cannot be confused at a call site.

Setting it requires `record.manage`, which only `training:ADMIN` holds and which is staleness-checked, and **no UI offers it**. It is break-glass against the lockout above, not a routine choice. It is audit-logged like any other sign-off and it is shown on the person's page: not settable in the UI is not the same as invisible.

Briefs are now checked before the override, closing a path by which an external brief could be given an expiry against [ADR-0003](0003-certifications-as-modules.md).

This does not supersede [ADR-0002](0002-expiry-stamped-at-award.md). Expiry is still computed once at award and stored, and the recalculation is still the only path that rewrites it. This narrows what that path touches.

## Alternatives considered

**Keep skipping by source and add the marker as a second condition.** Two rules for one idea, and the next value added to the `source` enum gets it wrong.

**Give the override its own column and treat non-null as the marker.** Two columns answering "when does this expire", and the marker still could not express "explicitly never".

**Mark only the EXTERNAL rows that actually carried a certificate date.** More precise, and rejected: old rows and new rows would then mean different things, and the operations runbook currently promises that recalculation never touches an external record. Preserving that promise is worth the small overstatement of marking an external record whose expiry did come from policy.

**Allow the override on session logging.** Wrong by construction: one date cannot describe fifteen records for twelve people across three modules.

**Allow an override on a `NONE` module.** Record-level truth beats catalogue-level policy, but it lets one signer invent an expiry policy that nobody else's records for that module follow. Refusing is recoverable: a lead can change the module's policy, or use the external route. Reverse this with a superseding ADR rather than by deleting the check.

**Put "never expires" in the UI behind a confirmation.** Rejected: it is a permanent claim about a safety record, made rare on purpose. An admin who genuinely needs it can reach the API, and the friction is the point.

## Consequences

Good: the skip rule now states the rule rather than a proxy for it. External behaviour is preserved bit for bit by the backfill. Every override is audit-logged alongside the policy date it replaced, so "who gave this person an extra year, and how much" is answerable from the audit row. The system has a documented way out of a lockout instead of needing hand-written SQL.

Bad: an external record whose expiry came from policy is nonetheless marked overridden, a deliberate overstatement kept so one column means one thing. An overridden row is permanently outside the recalculation, so correcting one is revoke plus re-grant. `skippedExternal` is renamed to `skippedOverridden`, which breaks any operator script that read it. And a never-expiring safety record is a real claim: it is audit-logged and visible, but nothing makes it lapse.
