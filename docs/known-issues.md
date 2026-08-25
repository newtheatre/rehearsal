# Known issues

Bugs that are understood but not fixed. A pull request that fixes one removes its entry.
Severity: **P1** breaks a task outright, **P2** costs someone real time or hides a failure,
**P3** is friction.

The UI review of 2026-08-24 raised nine defects across the register, the demand board and the app
shell, and all nine were fixed rather than filed. The practice-target key field, which could
silently overwrite a live target, went with them.

## P2: audit rows written before 2026-08-25 still carry free text about people

Five mutations used to copy a person's free text into `audit_log.detail` (revoke and decline
reasons, sign-off notes, certificate references, ad-hoc practice reasons), and `lead.add` copied a
real name. The handlers no longer do. Rows already written still hold it, and nothing in the app
updates `audit_log`, so the erasure hook cannot reach them: after an erasure, an admin searching
`/admin` for a phrase or a name can still pull back the anonymised person's history.

Clearing them is a hand-applied one-off, written up in [operations.md](operations.md#one-off-scrubbing-free-text-out-of-historical-audit-detail). Delete this entry when it has been run against
production, and note the date in the runbook.
