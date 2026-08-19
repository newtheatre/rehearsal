# ADR-0002: Expiry stamped at award time; validity derived at read time

**Status:** Accepted · **Date:** 2026-08-10 · **Deciders:** Matt Adcock (ITM 26/27)

## Context

Training can expire, with per-module configurable policy (never / months / academic year / external date). Two design axes: is a record's expiry computed when the record is created or whenever it is read? And is validity stored or derived?

## Decision

`expires_at` is computed once, at record creation, from the module's policy at that moment, and stored on the record. Validity state (VALID/EXPIRING/EXPIRED) is derived at read time from `expires_at` alone, by a single shared implementation. Policy changes affect future awards only; the sole retroactive path is an explicit, previewed, audit-logged admin recalculation.

## Alternatives considered

- **Derive expiry from module config at read time**, auto-applies policy changes; lost because a quiet config edit would silently strip (or extend) existing qualifications estate-wide, in a safety system, retroactivity must be a deliberate act with a diff in front of a human.
- **Stored validity state + transition job**, lost: a state column can lie (missed cron, race), and the cron becomes safety-critical. Derived state cannot be stale.

## Consequences

Good: records are self-contained evidence ("valid until X" was true when awarded and stays true); no safety-critical cron; the 1 October induction rollover emerges from the date maths. Bad: retroactive policy changes need the explicit recalc tool (built, audit-logged); `expires_at` on old records reflects old policy, which is exactly the point.
