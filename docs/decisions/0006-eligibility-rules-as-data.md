# ADR-0006: Eligibility rules are data; consumers enforce

**Status:** Accepted · **Date:** 2026-08-10 · **Deciders:** Matt Adcock (ITM 26/27), aligned with the Proscenium rota design

## Context

The rota needs "is this person duty-manager eligible?". The requirement is committee policy (currently proposed: valid induction + FOH management + fire procedure) and will change. The check could be hardcoded in the consumer, hardcoded here, or configurable, and enforcement could live on either side.

## Decision

Named eligibility rules (`duty-manager`, …) live in this app's `eligibility_rules` table as allOf/anyOf module lists, editable in the admin UI, audit-logged. The API answers `{ eligible, missing, expiring }`. **Enforcement is the consumer's**: Proscenium keeps its single `isDMEligible()` seam and decides what ineligibility means in its UX. This app never knows what a rule is *for*.

## Alternatives considered

- **Hardcode in the consumer** (query raw records, evaluate there), lost: policy changes become cross-repo deploys, and each future consumer reimplements validity semantics, precisely the divergence this system exists to end.
- **Hardcode here**, lost: still a deploy per policy change.
- **This app enforces (push authority)**, lost: it inverts ownership; the rota owns rota behaviour. Answering vs enforcing is the same boundary the estate draws everywhere (auth distributes roles; apps decide what they mean).

## Consequences

Good: committee changes the rule with zero deploys on either side; `missing`/`expiring` gives consumers actionable UX for free; new consumers cost a rule row and a token. Bad: rule edits are powerful and quiet: mitigated by audit logging and the documented tell-the-consumer-owner step; a renamed key breaks consumers (documented as a loud 404, and keys should simply never be renamed).
