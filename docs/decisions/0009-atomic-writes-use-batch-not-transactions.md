# ADR-0009: Multi-row writes are atomic via `db.batch()`, not transactions

**Status:** Accepted · **Date:** 2026-08-14 · **Deciders:** Matt Adcock (ITM 26/27)

## Context

Logging a session creates one record per attendee × module — five attendees on
three modules is fifteen rows plus the session and its two junction tables.
[records-and-expiry.md](../records-and-expiry.md) and the original plan both
describe this as happening "in one transaction", and it genuinely must be
all-or-nothing: a half-written session would leave some attendees credited with
training the others silently didn't get, which is precisely the failure this
system exists to prevent.

Drizzle's D1 driver exposes `db.transaction()`, and it type-checks. It is also
a trap. The implementation issues literal `begin` / `commit` statements, and
Cloudflare D1 rejects those over its HTTP API — every statement is
auto-committed. Worse, the local test driver (libsql) and Miniflare's local D1
emulation both *do* support `BEGIN`, so `db.transaction()` passes tests, passes
local dev, and fails only against production D1.

Verified directly against the production database before writing any of this:

```
$ npx wrangler d1 execute training --remote --command "BEGIN"
✘ [ERROR] ... not authorized to access this service [code: 7403]
```

## Decision

Any write that must be all-or-nothing is built as an array of statements and
executed with **`db.batch([...])`**, which D1 runs as a single implicit
transaction. `db.transaction()` is not used anywhere in this codebase.

Because the statements are constructed before any of them runs, ids that later
statements reference are generated up front (`nanoid()` in application code)
rather than read back from an insert — `records.session_id` is filled in from
the id the session insert was *given*, not one the database returned.

The test driver (libsql) implements `batch()` with the same atomicity, so a
partial-failure test means what it says.

## Alternatives considered

**`db.transaction()`.** The obvious choice and the one the docs implied.
Rejected on the evidence above: it fails only in production, which is the worst
place for a write-atomicity bug to first appear.

**Sequential writes plus a compensating cleanup on error.** Works without any
transaction support, but the cleanup path is itself a write that can fail, and
it would have to be correct for every partial state. Reinventing atomicity badly
when the platform offers it properly.

**Accept partial writes and reconcile later.** Never seriously considered for
safety records; it inverts the invariant that a record's existence is evidence.

## Consequences

Good: the atomicity the design assumed is real on the platform we actually
deploy to, and it is verified by a test that would pass spuriously under a
transaction-based implementation. Ids being generated in application code is a
small, contained discipline.

Bad: `batch()` takes a flat array, so anything conditional has to be decided
*before* the batch is assembled rather than mid-transaction — the session edit
path computes its whole diff first for this reason. Nested or interactive
patterns are simply unavailable; a future need for read-then-write-atomically
would have to be solved another way (optimistic checks, or a Durable Object).
