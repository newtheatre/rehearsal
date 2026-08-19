# Roadmap & Revisit Notes

Same conventions as the auth roadmap: each item states problem, sketch, and touches; picked-up items graduate via ADR into the main docs. Parking rules at the end.

> **Tracked work now lives in [GitHub issues](https://github.com/newtheatre/rehearsal/issues).** This document keeps the reasoning, why something is parked, what it would touch, what was rejected and why, which an issue title can't carry. The issues say what to do; this says why it is or isn't worth doing.

## Remaining build phases (committed)

Phases 2–6 of the project plan are committed work, not roadmap candidates: sessions and records, expiry and notifications, the read API and rota integration, the legacy migration, and handover docs. They are listed in the README's build-status table; their acceptance criteria live in the plan (§8) and the test list in [development.md](development.md#testing).

## R1, Scheduling & sign-ups *(committed direction, full design exists; build after a term of v1)*

The complete design is maintained as its own document (project doc *"NNT Training System, Scheduling & Sign-ups (v2 design)"*; lands in-repo as `docs/scheduling-design.md` when picked up). Summary: sessions gain `PLANNED→OPEN→FULL→DELIVERED|CANCELLED` states, capacity and waitlists with auto-promotion, self-service sign-up with prerequisite awareness, a phone register view where marking attendance *is* record creation, register-interest demand signals, ICS reminders, and a paste-a-link rooms tie-in. Deliberately second: a term of v1 expiry digests teaches us how NNT sessions actually get organised before we encode a workflow. **Touches:** data-model (additive), api-reference (two read endpoints), permissions (one row), operations (nag/undelivered procedures).

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
