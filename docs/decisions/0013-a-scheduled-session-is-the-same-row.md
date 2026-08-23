# ADR-0013: A scheduled session is the same row as a delivered one, and attendance is what awards

**Status:** Accepted · **Date:** 2026-08-22 · **Deciders:** Matt Adcock (ITM 26/27)

## Context

v1 records training that has already happened: `POST /api/sessions` writes the session and its
records in one batch, and the row is evidence of a thing that is over. Scheduling
([roadmap.md](../roadmap.md) R1, designed in [scheduling-design.md](../scheduling-design.md)) needs a
session to exist for weeks before it is taught, to be signed up to, and to be capable of being
cancelled without ever awarding anything.

That breaks the current identity of the row: today, a session existing *means* records exist. Two
shapes were available, and the choice determines whether the delivery log stays trustworthy.

## Decision

**One table, with a lifecycle.** `sessions` gains
`status ('PLANNED'|'OPEN'|'FULL'|'DELIVERED'|'CANCELLED')` defaulting to `DELIVERED`, plus the
scheduling columns. A session logged retrospectively is born `DELIVERED` through the endpoint that
exists today, unchanged. A scheduled one walks the lifecycle.

`session_attendees` gains
`status ('SIGNED_UP'|'CANCELLED'|'ATTENDED'|'ABSENT')` defaulting to `ATTENDED`, so sign-up and
attendance are one row per person rather than two tables that must agree.

**A place is derived, not stored.** There is no `WAITLISTED` status. Everyone who signs up is
`SIGNED_UP`, and whether they hold a place is `signed_up_at` order against `capacity`, computed at
read time by one helper. Storing it would mean checking a count and then writing a status, which two
simultaneous sign-ups can both pass, handing out the same last place twice; and it would put the
answer to "am I in" in two places, the status and the capacity, which is the shape invariant 4
exists to forbid. Withdrawal then promotes the next person by arithmetic rather than by an `UPDATE`
that can half-fail. `sessions.status = 'FULL'` is kept as a cached badge for the schedule list,
recomputed on each write; nothing authoritative reads it, and a sign-up never consults it.

**Records are created when the register is submitted, and only for the present cohort.** Not at
scheduling, not at sign-up, not on a timer. Marking the register *is* the awarding act, performed by
a named human, audit-logged, and refused outright on a session already `DELIVERED`.

Both defaults are chosen to fail safe as well as to backfill: a writer that forgets the status
creates something that looks finished, not an open sign-up sheet nobody is watching.

## Alternatives considered

- **A separate `planned_sessions` table, promoted on delivery.** Lost. Two tables describing the same
  evening have to be reconciled forever, and they drift the first time a lead schedules a session and
  then logs it by hand because they forgot it was there. It also makes "was TECH-111 taught in
  October" a union rather than a query.
- **Create the records at sign-up and revoke them for no-shows.** Lost, and it is the dangerous one.
  It would mean a record briefly existing for training that never happened, visible to the read API
  and to any consumer gating a safety decision on it in that window. Revocation exists for
  corrections, not as a routine step in the happy path
  ([ADR-0008](0008-records-revoked-never-deleted.md)).
- **A `RUNNING` status between `OPEN` and `DELIVERED`.** Lost. The fact worth storing is
  `register_opened_at`, a timestamp, and a lead who opens the register and pockets their phone has not
  changed what the session is.
- **Sign-ups in their own table.** Lost, per invariant 4: one question, one implementation.
- **A stored `WAITLISTED` status, with promotion on withdrawal.** Lost, per the race and the two
  sources of truth above. It reads more explicitly, which is its only real merit.
- **A `waitlist_position` integer.** Lost: it has to be renumbered on every withdrawal, and a
  renumbering that half-fails leaves two people third with no way to tell which is right.

## Consequences

Good: the retrospective path is untouched and could carry on alone if the rest were switched off;
one place to look for what was taught; a cancelled session leaves a visible, explained row; a no-show
gets nothing, so the existing hard prerequisite check on certification sign-off refuses them with no
new code, which is the requirement that motivated the feature.

Bad: `sessions` now carries columns meaningless for most of its rows, and every reader of the table
must be aware that `DELIVERED` is the only status whose records exist. Registers are capped at 60
attendees because submitting one is a single `db.batch()`
([ADR-0009](0009-atomic-writes-use-batch-not-transactions.md)) and an unbounded register is an
unbounded batch; the reasoning is in [scheduling-design.md](../scheduling-design.md) §5.3.
