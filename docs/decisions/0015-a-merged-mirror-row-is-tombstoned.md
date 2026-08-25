# ADR-0015: A merged-away mirror row is tombstoned, not deleted

**Status:** Accepted · **Date:** 2026-08-25 · **Deciders:** Matt Adcock (ITM 26/27)

## Context

When stage-door merges two accounts it calls every app's merge hook with the losing and the winning
id (stage-door ADR-0015). This app re-pointed every user-referencing column onto the winner and then
deleted the losing `users` row, and the closing delete was described as the enforcement: miss a
column and the merge fails on a foreign key.

Three things were wrong with that.

**The delete cannot enforce anything for a table with no key.** `audit_log.actor_user_id` and
`notification_log.user_id` carry no foreign key, so a missed re-point on either succeeds silently.
`audit_log` was in fact missed: every sign-off, revocation, module edit and lead change the person
made under the old account rendered as "Deleted user", and filtering the audit trail by the winning
id returned none of their history.

**The row came straight back.** The estate session cookie lasts thirty days and this app validates
nothing but staleness: there is no session epoch check anywhere in it. The person browsing on a tab
that still held the pre-merge cookie went through `ensureLocalUser`, whose upsert inserted the
deleted id again with the real name and email. The theatre then had two mirror rows for one human:
the merged one holding every record, and a resurrected ghost holding none. The ghost appeared in the
directory and the people list, and a lead picking it out of the attendee picker would award a safety
record against an id stage-door no longer answers for.

**A half-done merge could never be finished.** The hook issued its twenty-odd writes one at a time
and wrote its audit entry last. If everything landed and only the audit write failed, the losing row
was already gone, so the retry short-circuited on "this app has no mirror row for that id" and no
audit entry was ever written for a merge that had moved a person's entire training history.

## Decision

**`users.merged_into`**, nullable, referencing `users.id`. The merge hook sets it to the winning id
instead of deleting the row, and scrubs the row's email and name at the same time (the person's
identity now lives on the winner). The row exists only to occupy the id.

`ensureLocalUser`'s `setWhere` already refused to write back over an erased row; it now refuses a
tombstoned one too, so a cookie sealed before the merge cannot resurrect the losing id. The
directory, the people list, `ensureKnownUser` and `addressableUsers` all exclude tombstoned rows, so
a merged-away id cannot be picked, listed or emailed.

**The whole merge is one `db.batch()`**, audit entry included ([ADR-0009](0009-atomic-writes-use-batch-not-transactions.md)).
A failure leaves nothing tombstoned, so the automatic retry re-runs the merge from a clean state and
writes exactly one audit row.

**A count replaces the delete as the enforcement.** One statement counts every user-referencing
column for the losing id, before and after the batch. Before, it is the dry-run report and the audit
detail. After, a non-zero count means a column was missed, and the hook answers 500 naming it, which
stage-door records as `user.merge-incomplete` for an admin to re-run. That covers the two tables
with no foreign key, which the delete never could. The list of columns lives in one place in the
handler, `USER_COLUMNS`, and adding a user-referencing column to the schema means adding it there.

**A retry recognises a finished merge** by the tombstone plus a zero count, and returns
`alreadyMerged: true` without writing a second audit row. A merge that is tombstoned but still has
rows pointing at the loser is re-run rather than skipped, because the re-points are idempotent.

**Collisions are resolved by outcome, not by which account holds the row.** Where both accounts have
a `session_attendees` row for one session, the row evidencing the stronger outcome survives
(ATTENDED, then ABSENT, then a live sign-up, then a withdrawal) and carries the earlier sign-up
time, because a place is derived from sign-up order ([ADR-0013](0013-a-scheduled-session-is-the-same-row.md)).
Where both lead one department, the earlier appointment survives with the person who made it. Both
are expressed as statements whose bound-parameter count is fixed, never one statement per colliding
row: a person's attendance history is unbounded and D1 caps a statement at 100 parameters.

## Alternatives considered

**Keep the delete and add a separate tombstone table that `ensureLocalUser` consults.** Two places
to ask "is this id real", and the losing id would still be missing from `users`, so any column this
app forgets to re-point would break its foreign key at some unrelated later moment rather than at
the merge.

**Reuse `anonymised_at` for the tombstone.** It would have saved a column and cost the distinction
between "this person exercised their right to erasure" and "this account was folded into another
one". The GDPR hooks and the retention document both key off the first; conflating them is how a
merge starts being reported as an erasure.

**Re-point `audit_log` and leave everything else alone.** That fixes the trail and leaves the
resurrection and the unfinishable merge. It also mutates a table documented as append-only, which is
only defensible as part of a single decision that says why: a merge asserts that two ids were always
one person, so moving their actions onto the surviving id preserves the trail rather than rewriting
it. The merge is the only writer that ever updates an audit row.

**Refuse the merge when a collision needs judgement.** Tempting, given this repo would rather refuse
than guess. Rejected because the hook is called mid-merge by another app: refusing leaves the estate
half-merged, and the judgement here is not close. A marked register outranks a withdrawal.

## Consequences

Good: a merged-away id cannot be resurrected, picked, listed or emailed. The audit trail follows the
person. A transient failure is retried into a clean merge instead of an unfinishable one. A missed
column is reported rather than silent, including for the two tables with no key. The counts are one
statement rather than eighteen, so the hook makes roughly four round trips instead of forty.

Bad: `users` now holds a row per merged-away account forever, and every listing query has to exclude
them, which is a rule a new query can forget. `audit_log` gains a single sanctioned writer that
updates rather than appends. The response gains `alreadyMerged`, and `notMirrored` no longer becomes
true after a successful merge, which any operator script reading the hook's output must know.
