# ADR-0014: Practice targets are data, and are not eligibility rules

**Status:** Accepted · **Date:** 2026-08-22 · **Deciders:** Matt Adcock (ITM 26/27)

## Context

Proscenium is building training modes: sandboxes where someone learning the bar till, Challenge 25 or
the door scanner can practise without touching real money, stock or bookings. They must be reachable
only by people actively being taught the thing, and must close afterwards.

Only this app knows who is being taught what, so it has to answer. Two prior questions had to be
settled: which modules have a sandbox at all, and where that fact lives. Most modules have none.
Nobody needs a simulated lighting desk.

## Decision

**A new `practice_targets` table**: a named key a consumer hardcodes (`bar-till`, `challenge-25`,
`door-scan`), a list of module ids whose teaching opens it, a grace period, and a status.
Committee-editable in the admin UI beside the eligibility rules, and empty until somebody fills it
in.

**It is not `eligibility_rules`, and this is the substance of the decision.** The two answer
different questions and reusing one table would silently conflate them. The `bar` rule *requires*
NNT-001, the general induction, because you cannot work a bar shift without it. Teaching NNT-001 to
forty freshers must not open the till sandbox for forty freshers. Requirement runs one way, and what
a session actually teaches runs the other.

**It is not a column on `modules` either.** A consumer's identifier does not belong in the module
catalogue, and a target that spans several modules would have to be reassembled from scattered rows.

`practice_windows` is then the single answer to "is this person being taught this right now": opening
a register inserts one per signed-up attendee per matching target, and a lead may open one by hand
for ad-hoc coaching. Submitting the register closes them.

`GET /api/v1/practice/:key` answers for a service token, and is **`no-store`**. Eligibility is
cacheable for five minutes because it changes on the timescale of a training record; a practice
window changes on the timescale of a lesson ending, and a stale true keeps a sandbox open after the
lead has closed it.

As with eligibility, **this app answers and the consumer enforces**
([ADR-0006](0006-eligibility-rules-as-data.md)). It does not know what a sandbox is or what it lets
somebody do.

## Alternatives considered

- **Reuse `eligibility_rules`.** Lost, per the NNT-001 problem above. Zero new schema, wrong answers.
- **Hardcode the module list in Proscenium.** Lost: a catalogue renumbering would then be a
  coordinated deploy across two repos to fix something that is committee policy, which is exactly what
  [ADR-0006](0006-eligibility-rules-as-data.md) exists to prevent.
- **Derive it: any module taught opens a sandbox named after its department.** Lost. It guesses, and
  it guesses wrong for every module that has no sandbox, which is nearly all of them.
- **Let the consumer ask "is this person in a session teaching module X"** and decide for itself.
  Lost: it puts module ids in Proscenium, and it makes every consumer reimplement the mapping.

## Consequences

Good: which modules have a sandbox is one admin screen and no deploy; a lighting-desk session opens
nothing, silently and correctly; adding a sandbox in another app later is a row and a token.

Bad: a third named-key namespace consumers hardcode, so a renamed target breaks a consumer. Mitigated
the same way as eligibility rules: a loud 404 rather than a false answer, and keys are never renamed.
Two tables now describe relationships between rules and modules, and a reader has to know which is
which; the admin screens sit side by side and say so.
