# ADR-0016: The user mirror is best effort on a read, and the driver's own message is logged

**Status:** Accepted · **Date:** 2026-08-26 · **Deciders:** ITM

## Context

In the seven days to 2026-08-25 the worker logged around 320 errors against roughly 7,310
requests. Every one carried the same stack and nothing else:

```
[request error] [unhandled] [GET] https://training.newtheatre.org.uk/api/me
     at D1PreparedQuery.queryWithCache (index.js:27834:17)
    at async D1PreparedQuery.run (index.js:28029:59)
    ...
    at async $fetchRaw (index.js:21917:21)
```

They looked like failing reads: `/api/me`, `/api/departments`, `/api/modules`, `/api/people` and
`/api/me/records`, all plain authenticated GETs. They are not.

**The failing statement is a write.** In Drizzle's D1 driver `D1PreparedQuery.run` is reached only
from `db.insert`, `db.update` and `db.delete` without `returning()`. A select prepares with
`all`, `get` or `values` and never with `run`. The only write reachable from all five of those
routes is the user-mirror upsert in `server/utils/ensureLocalUser.ts`, which the global API
middleware performs on every authenticated request. The two frames above the driver match that
exactly: the mirror upsert is inlined into the middleware handler by the bundler, so it appears as
an anonymous frame directly inside `Object.handler`.

**We do not know why the write fails.** Drizzle wraps every failure in a `DrizzleQueryError` whose
`cause` holds the driver's real message and code, and Nitro logs only the stack. The cause never
reached the log, so whether this is a transient (`Network connection lost`), a `D1_ERROR`, or
storage overload is unestablished. Nothing in the Workers Observability dataset carries it either.

**Members were not seeing 500 pages, which is worse rather than better.** Page renders that logged
this error still returned 200: `useFetch` does not throw, so the failed internal fetch left `data`
null and filled an `error` ref, and a page that never read that ref rendered its empty state. The
dashboard said "Nothing recorded yet" to a member with records. Only the client-side fetches, made
after the page had already loaded, surfaced as 500s.

## Decision

Three things, none of which depends on knowing the cause.

**1. Log what the driver said.** `server/utils/dbError.ts` walks the cause chain and returns the
driver's own message, its code, and the SQL. `server/plugins/db-error-log.ts` hooks Nitro's `error`
and writes one `[db] ` line for any error that came from the database. The wrapper's own message is
never logged: it is the SQL *plus every bound value*, which for the mirror upsert is a member's
name and email address. Only placeholders reach the log.

**2. The mirror upsert may not fail a read.** The mirror is a derived convenience: rows that
records, sessions and leads point at, plus an `is_training_admin` cache for the cron's fan-out. No
GET needs it to answer. On `GET`, `HEAD` and `OPTIONS` the middleware logs the failure and
continues; on anything else it still throws, because a mutation may write a row that references
the caller and a missing mirror row would take the write down with a foreign-key error instead.
The debounce records the time only after a successful upsert, so a failed one retries on the
member's next request.

**3. No retry.** A retry is not justified on evidence we do not have, and the failing statement is
a write. D1 has no interactive transaction, so a retry around a write can only be argued from the
statement's own idempotence, which is a per-statement argument and not a policy. Revisit once the
logging from (1) has named the error.

## Alternatives considered

**Retry the statement once.** The distribution across five unrelated routes does look like a
transient any request can hit. But the statement is a write, the cause is unknown, and a retry
would hide the signal that the new logging exists to collect. Rejected for now, not for ever.

**Fire the mirror upsert into `waitUntil` and never await it.** It would take the write off the
request path entirely. It also means a sign-off can race the mirror row it depends on, which is
exactly the ordering the current synchronous upsert guarantees. Rejected: correctness of records
outranks latency.

**Drop the mirror and read names from the session.** The mirror exists because records, sessions
and leads foreign-key a real row, and because the expiry cron has no session to read from
([ADR-0015](0015-a-merged-mirror-row-is-tombstoned.md) depends on the row existing to tombstone).
Rejected.

**Log the whole Drizzle error.** One line, no new code, and it would have answered the question in
a day. It also writes a member's name and email address into the worker log on every failure.
Rejected outright.

## Consequences

- A D1 failure now names itself in the log as `[db] GET /api/me: <message> code=<code> sql=<sql>`.
  Watching for those lines is in [operations.md](../operations.md#monitoring).
- A catalogue read, a directory read or a dashboard read survives a failed mirror upsert. The
  mirror row is then up to one request stale, which self-heals.
- A mutation still refuses when the mirror cannot be written, and says so as a 500. That is the
  intended direction: better to refuse than to half-write a record.
- Pages now say when a fetch failed rather than rendering an empty state, so a member sees "Could
  not load your training" with a retry instead of "Nothing recorded yet".
- The underlying D1 failure is untouched. It stays in [known-issues.md](../known-issues.md) until
  the log says what it is.
