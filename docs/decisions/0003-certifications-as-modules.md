# ADR-0003: Certifications (and briefs) are kinds of module, not separate entities

**Status:** Accepted · **Date:** 2026-08-10 · **Deciders:** Matt Adcock (ITM 26/27), following the backstage subcommittee's scheme

## Context

The subcommittee's catalogue treats certifications (`LD-CERT`…) as rows alongside modules: same ID convention, same prerequisite column, one extra behaviour (manual sign-off conferring supervisor/trainer standing). Get-in/get-out briefs also looked module-shaped but recur per event and should never gate or expire.

## Decision

One `modules` table with `kind: MODULE | CERTIFICATION | BRIEF`. Certifications add `signoff_required` + `grants_*` flags and are created only via the sign-off flow. Briefs record attendance, display "last received", and are excluded from all gating and expiry.

## Alternatives considered

- **Separate `certifications` table**: cleaner conceptually; lost because it duplicates prerequisites, records, display, and API handling for rows the subcommittee themselves model identically. The behavioural differences are three flags.
- **Model briefs as annually-expiring modules**, lost: it abuses expiry to fake recurrence, generating meaningless EXPIRED states and warning emails for something that recurs weekly.

## Consequences

Good: one records pipeline, one API shape, prerequisites compose across kinds (certs require modules), the catalogue seed maps 1:1 from the spreadsheet. Bad: `kind` conditionals in a few flows (sign-off, display): bounded and tested; a future kind with genuinely different mechanics would force revisiting this.
