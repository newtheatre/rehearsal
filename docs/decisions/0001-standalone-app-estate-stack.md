# ADR-0001: Standalone app on the estate stack at training.newtheatre.org.uk

**Status:** Accepted · **Date:** 2026-08-10 · **Deciders:** Matt Adcock (ITM 26/27)

## Context

The new training system needed a home: inside Proscenium (which already runs the box office and will host the rota that consumes training data), or standalone. It also needed a stack decision, with the estate converging on Nuxt 4 + Drizzle + D1 + Workers and a shared auth service.

## Decision

A standalone Nuxt app in its own repo (`newtheatre/rehearsal`), own worker, own D1 database, served at `training.newtheatre.org.uk` (the domain the legacy system already taught members), on exactly the Proscenium/stage-door stack, integrated with the shared auth service from day one.

The repo and worker take the product name **Rehearsal**; the *domain* keeps the functional name `training`, matching the estate's existing split (`stage-door` serves `auth.newtheatre.org.uk`, `rooms` deploys the worker `room-bookings`). Members navigate by the functional name; maintainers talk about the product name.

## Alternatives considered

- **Module inside Proscenium**: no cross-service API needed for the rota; lost because it welds training to the box office's release cycle, grows an already-large app, and the API has to exist anyway for any *other* consumer. The rooms precedent (separate concern, separate app) fits better.
- **Any other stack**, lost instantly on maintainer continuity: one set of conventions across the estate is the estate's whole survival strategy.
- **Serving it at `rehearsal.newtheatre.org.uk`**, lost: the legacy system spent years teaching members that training lives at `training.`, and a rename buys nothing but broken links and confused inductees.

## Consequences

Good: independent deploys; the first app born clean on the shared auth (no local credentials ever); the familiar domain keeps meaning "training". Bad: one more worker/repo to operate (mitigated by the shared conventions and ops runbook); rota eligibility requires a network call (mitigated by caching and the documented fail-soft stance); the repo/domain name split needs stating once in the README so newcomers aren't surprised.
