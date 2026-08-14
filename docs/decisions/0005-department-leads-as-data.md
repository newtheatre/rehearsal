# ADR-0005: Department leads are app data, not auth-service roles

**Status:** Accepted · **Date:** 2026-08-10 · **Deciders:** Matt Adcock (ITM 26/27), reflecting committee structure

## Context

Sign-off authority and catalogue stewardship vary by department — tech's lead is the CTD, workshop/set the CWM, stage management the CSM; costume and producing leads are still to be named — and holders change every committee year. The overall owner is the Theatre Manager. Authority could be modelled as auth-service scoped roles (`training:SIGNOFF_TECH`…) or as data in this app.

## Decision

One auth-service role only: `training:ADMIN` (Theatre Manager + ITM). Per-department authority lives in a `department_leads` table (department → user ids), managed by admins in `/admin`, evaluated by this app's ability layer.

## Alternatives considered

- **Scoped roles per department** — lost: it multiplies auth-service role strings for authority that is *this app's* domain concept, puts the annual changeover through the auth admin UI (nine departments × leads), and contradicts the estate stance that authorisation logic stays in apps (stage-door ADR-0004). Roles answer "who is what estate-wide"; department leadership is not estate-wide.
- **Hardcode committee titles** — lost: titles and their training remits shift year to year; TBC departments prove the point.

## Consequences

Good: handover is row swaps by the TM/ITM; multiple leads per department are trivial; the auth service's role list stays clean. Bad: "what can this person do everywhere?" now has a training-app component the auth admin UI can't see (accepted — true of every app's domain permissions; the person page shows lead status). If Workspace-group sync ever lands estate-wide, leads could sync from committee groups — parked, roadmap R3.
