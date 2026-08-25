# Known issues

Bugs that are understood but not fixed. A pull request that fixes one removes its entry.
Severity: **P1** breaks a task outright, **P2** costs someone real time or hides a failure,
**P3** is friction.

The UI review of 2026-08-24 raised nine defects across the register, the demand board and the app
shell, and all nine were fixed rather than filed. The practice-target key field, which could
silently overwrite a live target, went with them.

## P2: the user-mirror upsert fails against D1 often enough to notice, and nobody knows why

Every authenticated `/api/**` request upserts the caller into the local user mirror
(`server/utils/ensureLocalUser.ts`, called from the global middleware). In the seven days to
2026-08-25 that statement failed around 320 times against roughly 7,310 requests. The stack was all
that reached the log, and it named `D1PreparedQuery.run`, which in Drizzle's D1 driver is only ever
an insert, update or delete: the mirror upsert is the only write on the routes that reported it.

The failure is now survivable and no longer silent: a read continues without the mirror row and the
driver's own message is logged ([ADR-0016](decisions/0016-the-user-mirror-is-best-effort-on-a-read.md)).
What actually fails is still unknown, so nothing retries and nothing is tuned for a particular
cause. Watch the `[db]` lines described in [operations.md](operations.md#db-log-lines) for a week
after the deploy: the driver's message and code are what decide whether this is a transient worth
one retry, an overloaded database, or a real fault in the statement. Delete this entry when it has
an answer.

## P3: two phones opening one register at the same instant insert duplicate practice windows

`POST /api/sessions/:id/register/open` is guarded by "has `register_opened_at` been stamped", which
is a read. Two leads tapping at the same instant both read it as null, and each inserts a full set
of practice windows for the room. Everything else about the double tap is safe: the stamp, the
windows and the audit entry are one batch, so neither attempt half-lands, and `hasOpenWindow`
orders by `expires_at` descending, so holding two windows never shortens the answer a consumer
gets. What is left is duplicate rows in `practice_windows` and a second `session.register.open`
audit entry.

Closing it needs a unique index over `(session_id, user_id, target_key)`, which is a schema change
rather than a handler one, and `practice_windows` also holds ad-hoc grants with a null `session_id`
that must stay unconstrained. Worth doing when something else takes that table to a migration.

## P2: audit rows written before 2026-08-25 still carry free text about people

Five mutations used to copy a person's free text into `audit_log.detail` (revoke and decline
reasons, sign-off notes, certificate references, ad-hoc practice reasons), and `lead.add` copied a
real name. The handlers no longer do. Rows already written still hold it, and nothing in the app
updates `audit_log`, so the erasure hook cannot reach them: after an erasure, an admin searching
`/admin` for a phrase or a name can still pull back the anonymised person's history.

Clearing them is a hand-applied one-off, written up in [operations.md](operations.md#one-off-scrubbing-free-text-out-of-historical-audit-detail). Delete this entry when it has been run against
production, and note the date in the runbook.
