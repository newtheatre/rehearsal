# Development

## Prerequisites

Bun ≥ 1.2, Node 20+ (tooling), wrangler (authenticated only for production D1 — most work doesn't need it). No Cloudflare account for local dev: D1 runs as local SQLite.

## Setup

```bash
git clone https://github.com/newtheatre/rehearsal && cd rehearsal
bun install
cp .env.example .env
bun run db:migrate
bun run db:seed        # catalogue + sample users, trainer, records; credentials printed
bun run dev            # http://localhost:3000
```

`.env` keys (never commit `.env`):

| Key | Dev value |
|---|---|
| `NUXT_SESSION_PASSWORD` | any 32+ char string; **match the auth service's dev value if running both** |
| `NUXT_RESEND_API_KEY` | leave unset — dev logs emails to the console |
| `NUXT_AUTH_SERVICE_TOKEN` | leave unset — dev stubs the shadow endpoint (add-by-email creates a local-only mirror row, clearly marked) |

Auth in dev follows the estate pattern (stage-door `docs/development.md`): host-only cookies on localhost, and a dev-only seeded-session login route guarded by `import.meta.dev` — the sanctioned exception to "apps never write sessions", absent from production builds. You do not need the auth service running for normal work.

### `/dev-login`

| URL | Signs you in as |
|---|---|
| `/dev-login` | ordinary member, no roles |
| `/dev-login?admin=1` | `training:ADMIN` |
| `/dev-login?lead=TECH` | department lead for TECH (creates the `department_leads` row) |
| `/dev-login?trainer=1` | member holding a valid `LEAD-CERT` record |

The route redirects to `/` once the session is sealed. It 404s in production builds.

## Seeds

`bun run db:seed` loads the full module catalogue (same parser as the production seed — [migration.md](migration.md)), a handful of users (member, trainer with valid LEAD-CERT, department lead, admin), and fixture records covering every state: VALID, EXPIRING, EXPIRED, revoked, BRIEF attendance, external cert. Random credentials printed, never committed; refuses to run in production.

> **Phase 1 caveat:** records/sessions land in Phase 2, so today's seed populates departments, the catalogue, users and leads only. `data/catalogue.csv` is a **placeholder** built from the modules named in the design docs — replace it with the subcommittee's export before anything real depends on it (see the file's header and [migration.md](migration.md#1-catalogue-seed)).

## Testing

```bash
bun run test           # vitest: unit + integration (h3 app, in-memory SQLite)
```

High-value suites — keep these green and comprehensive; they encode the safety posture:

- **Expiry stamping**: each mode; `ACADEMIC_YEAR` boundary cases (award on 29/30 Sep, 1 Oct); external-date precedence; config change affecting future records only.
- **Validity derivation**: state at boundaries (expires today = EXPIRED); warning window edges; BRIEF exclusion; the SQL fragment and the util agreeing on fixtures.
- **Sign-off gating**: unmet prerequisite blocks with named modules; EXPIRING counts; revoked doesn't; server-side even when the UI wouldn't offer it.
- **Trainer derivation**: valid cert passes, expired fails, revoked fails, admin bypass works.
- **Session → records**: attendee × module fan-out; transactionality (partial failure creates nothing); edit-window re-derivation; add-by-email path.
- **Eligibility**: allOf/anyOf truth table; unknown key/user; list form matches per-user form on fixtures.
- **API auth**: valid/invalid/missing token; email never in any payload (assert on serialisers).
- **Cron**: dry-run produces the exactly-expected send list on fixtures incl. a mocked 30 Sep rollover; idempotency (running twice sends nothing new).

Suites for phases not yet built are listed here deliberately — they are the acceptance criteria for those phases, not a claim that they exist.

Every PR touching record creation, validity, gating, or eligibility adds a test that fails without the change (CLAUDE.md).

## Working with Claude Code

Read `CLAUDE.md` first. Point sessions at doc sections ("implement sign-off per records-and-expiry.md + permissions.md") rather than re-describing; the docs are the spec. Failing test first for anything in the suites above. Any diff touching invariants 2–5 gets a human read, not a skim.
