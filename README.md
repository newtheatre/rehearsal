# Rehearsal: NNT Training System

Training records for the Nottingham New Theatre: **who is trained in what, and whether that training is currently valid**. Trainers log sessions; completion records derive from them; certifications are signed off; records can expire; other estate apps query a token-secured API: the first consumer is Proscenium's FOH rota (duty-manager eligibility).

**Live at:** `https://training.newtheatre.org.uk` · **Owner:** IT Manager / Archivist (overall training authority: Theatre Manager) · **Status:** spec-first: these docs were written before the code and are the source of truth during the build. Where code and docs disagree during implementation, the docs win until a documented decision says otherwise.

The repo is `rehearsal`; the domain stays `training.newtheatre.org.uk` because that is what it already means to members ([ADR-0001](docs/decisions/0001-standalone-app-estate-stack.md)): the same split as `stage-door` → `auth.newtheatre.org.uk`.

Replaces the legacy Django app (`newtheatre/nt-training`, Heroku, stale since 2019). We deliberately kept almost none of its data: see [docs/migration.md](docs/migration.md).

## What it does

- **Module catalogue** under the backstage subcommittee's `DEPT-LCT` scheme, with prerequisites, per-module expiry policy, and a materials link (always a Drive doc/presentation/folder) per module.
- **Sessions** logged by trainers (date, modules, attendees) create the records: the who-trained-whom audit trail.
- **Certifications** (`LD-CERT`, `SM-CERT`, …) as sign-off-gated bundles that confer supervisor/trainer standing.
- **Configurable expiry**: never / N months / academic year / external-certificate date, stamped at award time.
- **Read API** for estate apps: records, holders, and data-driven **eligibility rules** (e.g. `duty-manager`).
- **Notifications**: expiry warnings to members, monthly digests to department leads and the TM/ITM.

Everything requires login (shared NNT auth, Google SSO for members); nothing is public: a deliberate change from the legacy site.

## How it works in one paragraph

Members sign in via the shared auth service (sealed-cookie SSO, see the `newtheatre/stage-door` docs; this app never writes the session). A trainer whose Trainer certification (`LEAD-CERT`) is currently valid logs a session; one record per attendee × module is created, each stamped with an expiry date computed from the module's policy at that moment. Validity (`VALID` / `EXPIRING` / `EXPIRED`) is always derived at read time, gates certification sign-off and API eligibility answers, and drives the notification cron. Department leads (data, not roles, [ADR-0005](docs/decisions/0005-department-leads-as-data.md)) sign off certifications and steward their department's modules; the Theatre Manager and ITM hold the only auth-service role, `training:ADMIN`.

## Quick start (development)

```bash
git clone https://github.com/newtheatre/rehearsal && cd rehearsal
bun install
cp .env.example .env      # fill in per docs/development.md
bun run db:migrate        # local SQLite
bun run db:seed           # module catalogue + dev users (no passwords, see /dev-login)
bun run dev               # http://localhost:3000
```

First success in under five minutes: sign in at `/dev-login?trainer=1`, log a session at `/sessions/new`, and watch the records appear on the attendees' pages. Full local-dev story: [docs/development.md](docs/development.md).

## Build status

| Phase | Scope | State |
|---|---|---|
| 1 | Scaffold, auth wiring, catalogue seed, catalogue pages, admin module CRUD | **done** |
| 2 | Sessions + records, sign-off, external certs, people directory | **done** |
| 3 | Expiry states + notifications cron | **done** |
| 4 | Read API + eligibility rules | **done** (rota integration blocked, the rota isn't built) |
| 5 | Legacy migration + Heroku shutdown | not started |
| 6 | Docs + handover | not started |
| 7 | Scheduling, sign-ups, registers and practice windows | designed, not started ([docs/scheduling-design.md](docs/scheduling-design.md)) |

Phase definitions and acceptance criteria: the project plan (§8) and [docs/roadmap.md](docs/roadmap.md).

## Documentation map

| Doc | Read it when… |
|---|---|
| [docs/architecture.md](docs/architecture.md) | you want the system in your head: components, flows, trust boundaries |
| [docs/records-and-expiry.md](docs/records-and-expiry.md) | you're touching anything that creates or evaluates a record: **the semantics both the app and API consumers rely on** |
| [docs/data-model.md](docs/data-model.md) | you're changing the schema |
| [docs/permissions.md](docs/permissions.md) | you're adding an endpoint or a page: who may do what, and why leads aren't roles |
| [docs/api-reference.md](docs/api-reference.md) | you're calling or changing an endpoint |
| [docs/consuming-the-api.md](docs/consuming-the-api.md) | **you're wiring another estate app to training data**: the rota is the reference consumer |
| [docs/development.md](docs/development.md) | you're setting up locally or writing tests |
| [docs/operations.md](docs/operations.md) | something is on fire, or it's handover, or you're issuing a token |
| [docs/gdpr-retention.md](docs/gdpr-retention.md) | erasure, subject access, how long records live |
| [docs/migration.md](docs/migration.md) | the catalogue seed and the one-off legacy import (historical after cutover) |
| [docs/scheduling-design.md](docs/scheduling-design.md) | **you're building scheduling, sign-ups, registers or practice windows**: the spec for phase 7 |
| [docs/roadmap.md](docs/roadmap.md) | future work: what is parked, and why |
| [docs/decisions/](docs/decisions/) | you're about to ask "why on earth is it done this way?" |
| [CLAUDE.md](CLAUDE.md) | you are Claude Code (or pairing with it) |

## Stack

Nuxt 4 · Drizzle + Cloudflare D1 (via `@nuxthub/core`) · `@nuxt/ui` · Resend (email) · Cloudflare Workers (`cloudflare_module` preset) · Bun · shared NNT auth (`nuxt-auth-utils` sessions, read-only). Deliberately identical to Proscenium/stage-door: see [ADR-0001](docs/decisions/0001-standalone-app-estate-stack.md).

## Contributing

Small estate, small team: branch, PR, and every PR that changes behaviour updates the relevant doc in the same PR. Module *content* (names, descriptions, prerequisites, expiry policies, materials) belongs to the backstage subcommittee and lives in the database, not in code: content changes are admin-UI operations, never deploys.
