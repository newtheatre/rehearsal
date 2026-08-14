# Architecture Decision Records

Why the system is the way it is. One decision per file, numbered, never edited after acceptance — supersede instead. Same template as the `newtheatre/stage-door` repo (reproduced below).

| # | Decision | Status |
|---|---|---|
| [0001](0001-standalone-app-estate-stack.md) | Standalone app on the estate stack at training.newtheatre.org.uk | Accepted |
| [0002](0002-expiry-stamped-at-award.md) | Expiry stamped at award time; validity derived at read time | Accepted |
| [0003](0003-certifications-as-modules.md) | Certifications (and briefs) are kinds of module, not separate entities | Accepted |
| [0004](0004-trainer-standing-from-records.md) | Trainer ability derives from a valid Trainer certification record | Accepted |
| [0005](0005-department-leads-as-data.md) | Department leads are app data, not auth-service roles | Accepted |
| [0006](0006-eligibility-rules-as-data.md) | Eligibility rules are data; consumers enforce | Accepted |
| [0007](0007-map-active-members-only.md) | Legacy migration maps active members only; the archive dump is the history | Accepted |
| [0008](0008-records-revoked-never-deleted.md) | Records are revoked, never deleted | Accepted |
| [0009](0009-atomic-writes-use-batch-not-transactions.md) | Multi-row writes are atomic via `db.batch()`, not transactions | Accepted |

## Template

```md
# ADR-NNNN: Title

**Status:** Proposed | Accepted | Superseded by ADR-MMMM · **Date:** YYYY-MM-DD · **Deciders:** …

## Context

## Decision

## Alternatives considered

## Consequences
```
