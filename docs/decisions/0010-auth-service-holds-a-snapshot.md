# ADR-0010: The auth service holds a long-lived snapshot of our answers

**Status:** Accepted · **Date:** 2026-08-18 · **Deciders:** IT Manager · Relates to [ADR-0006](0006-eligibility-rules-as-data.md)

## Context

[ADR-0006](0006-eligibility-rules-as-data.md) made eligibility rules named data
and set the stance: this app answers, consumers enforce.
[consuming-the-api.md](../consuming-the-api.md) tells consumers to treat the
answer as **advisory-fresh, never transactional**, and the endpoints send
`Cache-Control: private, max-age=300` to say so.

The auth service is now our first real consumer, and it does something the
guidance did not anticipate. A role grant there can be made **conditional** on
one of our rules, and an unmet answer makes the grant inert, so the person loses
the role across the estate (its ADR-0019). It reads
`GET /api/v1/eligibility/:key` once a day and stores the eligible set. So an
answer of ours, up to a day old, can remove somebody's access.

That is a stretch of "advisory-fresh". It deserves recording here rather than
being discovered later by someone reading our doc and finding it contradicted.

## Decision

**We accept it, and the guidance stands unchanged for everyone else.**

What makes it acceptable is the shape of the auth service's use, not the
freshness:

- It never calls us on a request path. Sealing a session reads its own snapshot
  table, so we are not on the estate's login path and an outage here cannot make
  logging in fail.
- A failed read leaves its previous snapshot in force indefinitely. Our being
  down never changes anyone's access.
- A rule it has never successfully read does not enforce at all.
- Enforcing is refused on any `ADMIN` role, including `training:ADMIN`. A wrong
  answer from us therefore cannot remove the accounts that would fix it here,
  which was the one genuinely unrecoverable failure.

So the direction of failure is always towards leaving access alone, which is the
same instruction `consuming-the-api.md` gives the rota: choose your failure
direction deliberately, and prefer the one a human can correct.

**Two obligations follow for us.**

First, a rule key that any conditional grant references is load-bearing
estate-wide. Renaming or deleting one silently removes a privilege from
everyone holding the role, a day later. `eligibility_rules.key` was already
"never rename; consumers hardcode it"; this makes the cost concrete.

Second, our answers are now an input to somebody's authorisation. A revoked
record or a mis-keyed module id is no longer only a reporting error here.

## Alternatives considered

- **Refuse the use and tell the auth service to stay advisory.** It would leave
  the lapse problem exactly where it was, on a handover checklist. The whole
  point of holding certifications as data with real expiry is that something can
  act on them.
- **Require it to read us live at seal time.** It would make our uptime a
  precondition for logging into anything on the estate. Emphatically not.
- **Push to it when a record changes** instead of being polled. Better latency,
  and it makes us responsible for the auth service's correctness and gives us a
  retry queue to own. The daily pull, plus its admin refresh button, is enough:
  certification expiry is calendar-driven, so a day's granularity catches every
  lapse anyway.

## Consequences

Good: a lapsed certification now removes an estate privilege with no admin
action, which is exactly the property [ADR-0004](0004-trainer-standing-from-records.md)
already gives trainer standing inside this app. The two systems finally agree
about what a lapse means.

Bad: our data-entry errors have a wider blast radius, and a rule key is now
harder to change than the table suggests. The five-minute cache header on
`/api/v1/eligibility/:key` is now advisory in the literal sense: our first real
consumer caches for a day, deliberately, and the header does not stop it.
