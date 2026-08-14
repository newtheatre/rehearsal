# ADR-0004: Trainer ability derives from a valid Trainer certification record

**Status:** Accepted · **Date:** 2026-08-10 · **Deciders:** Matt Adcock (ITM 26/27)

## Context

Who may log sessions? The legacy system let anyone be named trainer. The subcommittee's scheme includes `LEAD-CERT` ("Trainer") — run training unsupervised, after LEAD-301 + supervised delivery + sign-off. The system could gate session logging by an auth role, an app flag, or the certification itself.

## Decision

The ability to log sessions is derived, at request time, from holding a currently-valid record for a `grants_trainer` certification (plus `training:ADMIN` as bypass). No trainer role, no flag, no session caching. Bootstrap: admins grant the first Trainer certs manually as `SIGNOFF` records.

## Alternatives considered

- **`training:TRAINER` auth role** — lost: it duplicates state the system already holds authoritatively (the cert record), can drift from it, adds auth-service admin work per trainer, and — if LEAD-CERT expires annually — someone must remember to revoke roles. Deriving from the record makes trainer standing exactly as current as the training that justifies it.
- **Keep it open (legacy behaviour)** — lost: the subcommittee explicitly designed the Trainer cert to end this.

## Consequences

Good: the system eats its own dog food — the trainer list is *definitionally* the list of valid Trainer certs; expiry of the cert greys the ability out with no admin action; provenance is visible on the trainer's own record page. Bad: one extra DB read on session-flow requests (trivial); the bootstrap grant must be done before the first real session (documented in operations + migration).
