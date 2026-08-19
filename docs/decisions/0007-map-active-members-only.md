# ADR-0007: Legacy migration maps active members only; the archive dump is the history

**Status:** Accepted · **Date:** 2026-08-10 · **Deciders:** Matt Adcock (ITM 26/27)

## Context

The legacy system holds ~7 years of records under the old module numbering, stale since 2019, publicly visible, for a population that has almost entirely graduated. The subcommittee's new scheme has a many-to-one mapping from old modules (the *Old Module(s)* column). Options ranged from full import to nothing.

## Decision

A reviewed, one-off import for **active members only**: script proposes grants (all constituent old modules held → new module), department leads review the CSV, the import creates `LEGACY` records with original dates (expiry stamped normally, so stale training arrives expired). Everyone else starts fresh. The complete legacy database survives as an archived `pg_dump` in the Archive drive; the Heroku app is then deleted.

## Alternatives considered

- **Full historical import**, lost: thousands of records for departed members, under a retired scheme, in a system whose directory shows people, maximum GDPR surface for near-zero operational value. The dump answers historical questions at zero runtime cost.
- **Fresh start entirely**, lost narrowly: defensible, but forcing the handful of demonstrably-trained current members to re-certify wastes real trainer hours in year one, when trainer capacity is the bottleneck.
- **Lazy per-person claiming**, lost: keeps a legacy lookup path alive indefinitely for a tail that never converges.

## Consequences

Good: the live system contains only people with a reason to be in it; year-one training effort goes to genuinely new people; history is preserved where history belongs (the archive). Bad: the review is human work for the leads (bounded: tens of rows); anyone missed re-trains or asks the Archivist to consult the dump: an acceptable, reversible cost.
