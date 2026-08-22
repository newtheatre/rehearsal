# Roadmap & Revisit Notes

Same conventions as the auth roadmap: each item states problem, sketch, and touches; picked-up items graduate via ADR into the main docs. Parking rules at the end.

> **Tracked work now lives in [GitHub issues](https://github.com/newtheatre/rehearsal/issues).** This document keeps the reasoning, why something is parked, what it would touch, what was rejected and why, which an issue title can't carry. The issues say what to do; this says why it is or isn't worth doing.

## Remaining build phases (committed)

Phases 2–6 of the project plan are committed work, not roadmap candidates: sessions and records, expiry and notifications, the read API and rota integration, the legacy migration, and handover docs. They are listed in the README's build-status table; their acceptance criteria live in the plan (§8) and the test list in [development.md](development.md#testing).

## R1, Scheduling & sign-ups *(**picked up**, August 2026)*

Graduated. The design is now in-repo as [scheduling-design.md](scheduling-design.md), with
[ADR-0013](decisions/0013-a-scheduled-session-is-the-same-row.md) (a scheduled session is the same
row as a delivered one; attendance is what awards) and
[ADR-0014](decisions/0014-practice-targets-are-data.md) (practice targets are data, and are not
eligibility rules).

Picked up ahead of the "after a term of v1" gate because Proscenium's training modes need practice
windows, which only exist once sessions can be scheduled and signed up to. The trade the original
parking accepted is therefore still open: we are encoding a workflow before a term of digests taught
us how NNT sessions actually get organised. §11 of the design doc keeps the questions a term of use
should answer, and answering them is a revisit rather than a rebuild.

ICS attachments are the one part of the original sketch deferred; the rest is in the design.

## R2: Cert auto-suspension on lapsed constituents *(committee decision needed)*

v1 flags a valid cert whose component modules have expired; it does not suspend it. If the committee decides lapsed components should suspend the cert (likely for safety-critical chains), implement in the validity util (derived, like everything else): **not** as stored state. Small build; the entire decision is policy, not code.

## R3, Candidates *(gathered, not committed, review at handover)*

- **Get-in attendance analytics**: BRIEF records already accumulate per-event attendance; a term view ("who's been to how many get-ins") is a query and a page. Build when someone actually asks.
- **Supervisor lookup on the FOH/backstage screens**: Proscenium surfaces "valid supervisors in the building tonight" via `GET /records?module=…`. Needs nothing from this app beyond what v1 ships; it's a consumer feature.
- **Printable/wallet cert summary**: a person-page PDF export for external hirers or SU paperwork. Cheap; wait for a real request.
- **Workspace-group-driven anything**: parked estate-wide (auth roadmap R3 owns the investigation). Nothing in this app should assume it.
- **Materials inside the app**: explicitly rejected; Drive owns content. Revisit only if Drive linking demonstrably fails members.

## Parking rules

Items live here until someone commits to them. Adding: problem + sketch + touches, honest about cost. Removing: graduated (link the ADR) or record why dropped.
