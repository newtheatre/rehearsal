# Development

## Prerequisites

Bun ≥ 1.2, Node 20+ (tooling), wrangler (authenticated only for production D1, most work doesn't need it). No Cloudflare account for local dev: D1 runs as local SQLite.

## Setup

```bash
git clone https://github.com/newtheatre/rehearsal && cd rehearsal
bun install
cp .env.example .env
bun run db:migrate
bun run db:seed        # catalogue + sample users covering every ability
bun run dev            # http://localhost:3000
```

`.env` keys (never commit `.env`):

| Key | Dev value |
|---|---|
| `NUXT_SESSION_PASSWORD` | any 32+ char string; **match the auth service's dev value if running both** |
| `NUXT_RESEND_API_KEY` | leave unset: dev logs emails to the console |
| `NUXT_AUTH_SERVICE_TOKEN` | leave unset: dev stubs the shadow endpoint (add-by-email creates a local-only mirror row, clearly marked) |

Auth in dev follows the estate pattern (stage-door `docs/development.md`): host-only cookies on localhost, and a dev-only seeded-session login route guarded by `import.meta.dev`: the sanctioned exception to "apps never write sessions", absent from production builds. You do not need the auth service running for normal work.

### `/dev-login`

| URL | Signs you in as |
|---|---|
| `/dev-login` | ordinary member, no roles |
| `/dev-login?admin=1` | `training:ADMIN` |
| `/dev-login?lead=TECH` | department lead for TECH (creates the `department_leads` row) |
| `/dev-login?trainer=1` | member holding a valid `LEAD-CERT` record |

The route redirects to `/` once the session is sealed. It 404s in production builds.

It uses `replaceUserSession`, not `setUserSession`: the latter merges into the existing
session and concatenates arrays, so switching from admin to member kept the admin role
while swapping the id. If you add a persona here, keep the replacement semantics: dev
testing that quietly runs with more authority than you asked for is worse than no dev
login at all.

## Seeds

`bun run db:seed` loads the full module catalogue (same parser as the production seed, [migration.md](migration.md)) and a handful of users covering every ability: member, trainer, department lead, admin. It refuses to run in production or against a remote database.

**There are no credentials to print**: this app has no passwords, ever. The seeded users share their ids with the ones `/dev-login` creates, so seeding and signing in agree. The trainer's standing is seeded as a real `SIGNOFF` record rather than a flag, because deriving it from a record is the whole point of [ADR-0004](decisions/0004-trainer-standing-from-records.md).

Once Phase 2 lands, the seed will also carry fixture records covering every state: VALID, EXPIRING, EXPIRED, revoked, BRIEF attendance, external cert.

> **Caveat:** `data/catalogue.csv` is a **placeholder** built from the modules named in the design docs: replace it with the subcommittee's export before anything real depends on it (see [data/README.md](../data/README.md) and [migration.md](migration.md#1-catalogue-seed)). The seed activates a slice of it so an ordinary member has something to look at; the real statuses come from the subcommittee's own Status column.

## Testing

```bash
bun run test           # vitest: unit + integration (h3 app, in-memory SQLite)
```

High-value suites, keep these green and comprehensive; they encode the safety posture:

- **Expiry stamping**: each mode; `ACADEMIC_YEAR` boundary cases (award on 29/30 Sep, 1 Oct); external-date precedence; config change affecting future records only.
- **Validity derivation**: state at boundaries (expires today = EXPIRED); warning window edges; BRIEF exclusion; the SQL fragment and the util agreeing on fixtures.
- **Sign-off gating**: unmet prerequisite blocks with named modules; EXPIRING counts; revoked doesn't; server-side even when the UI wouldn't offer it.
- **Trainer derivation**: valid cert passes, expired fails, revoked fails, admin bypass works.
- **Session → records**: attendee × module fan-out; transactionality (partial failure creates nothing); edit-window re-derivation; add-by-email path.
- **Eligibility**: allOf/anyOf truth table; unknown key/user; list form matches per-user form on fixtures.
- **API auth**: valid/invalid/missing token; email never in any payload (assert on serialisers).
- **Cron**: dry-run produces the exactly-expected send list on fixtures incl. a mocked 30 Sep rollover; idempotency (running twice sends nothing new).

Suites for phases not yet built are listed here deliberately: they are the acceptance criteria for those phases, not a claim that they exist.

Every PR touching record creation, validity, gating, or eligibility adds a test that fails without the change (CLAUDE.md).

## Working with Claude Code

Read `CLAUDE.md` first. Point sessions at doc sections ("implement sign-off per records-and-expiry.md + permissions.md") rather than re-describing; the docs are the spec. Failing test first for anything in the suites above. Any diff touching invariants 2–5 gets a human read, not a skim.
