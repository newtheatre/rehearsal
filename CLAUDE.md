# CLAUDE.md — working on newtheatre/rehearsal

Guidance for Claude Code sessions in this repo. A human (usually the NNT IT Manager) reviews everything; write code and docs they can hand to a successor.

## What this is

The estate's training-records system ("Rehearsal", served at `training.newtheatre.org.uk`). Its records gate real-world safety decisions (who may supervise a build, who may duty-manage a performance), so **correctness of records outranks convenience everywhere**: better to refuse an operation than silently create or destroy a record.

## Commands

```bash
bun install            # deps (Bun is the package manager — do not use npm/yarn)
bun run dev            # local dev server on :3000
bun run db:migrate     # apply Drizzle migrations locally
bun run db:generate    # generate a migration from schema changes (review the SQL!)
bun run db:seed        # dev-only: module catalogue + sample users/records; refuses in production
bun run seed:catalogue # parse data/catalogue.csv into the local database
bun run test           # unit + integration (vitest)
bun run lint           # eslint (matches Proscenium's config)
bun run typecheck      # nuxi typecheck
npx wrangler d1 ...    # production D1 — read docs/operations.md before touching
```

## Source of truth & docs discipline

- Spec-first: while building, implement what the docs say; if a doc is wrong or infeasible, *stop and flag it* — don't silently diverge. After cutover, code is truth and docs must follow it.
- **Any PR that changes behaviour updates the matching doc in the same PR.** Schema → `docs/data-model.md`; endpoints → `docs/api-reference.md`; record/expiry semantics → `docs/records-and-expiry.md`; anything an operator does → `docs/operations.md`.
- New architectural choice, or reversing an old one → ADR in `docs/decisions/` (template in that folder's README). Never edit an accepted ADR's decision; supersede it.

## Invariants — do not break these

1. **This app never writes the session.** `getUserSession()`/`requireUserSession()` read-only; login/logout are redirects to `auth.newtheatre.org.uk`. No credential storage, ever. (Sole exception: `server/routes/dev-login.get.ts`, guarded by `import.meta.dev`.)
2. **Records are append-only.** Corrections are revocations (with reason) plus new grants. No handler, migration, or script hard-deletes a `records` row. ([ADR-0008](docs/decisions/0008-records-revoked-never-deleted.md))
3. **`expires_at` is stamped at creation and never recomputed implicitly.** The only path that rewrites stored expiries is the explicit, previewed, audit-logged admin recalculation. ([ADR-0002](docs/decisions/0002-expiry-stamped-at-award.md))
4. **Validity is derived, never stored.** No `state` column; the shared util + SQL fragment in `server/utils/validity.ts` is the single implementation. Two implementations of "is this valid?" is how safety systems lie.
5. **Certification sign-off hard-checks prerequisites server-side** (all prerequisite records VALID/EXPIRING). The UI disabling a button is not the check.
6. **Trainer ability is derived from a valid `grants_trainer` record at request time** — never cached in the session, never a role. ([ADR-0004](docs/decisions/0004-trainer-standing-from-records.md))
7. **User ids are canonical auth ids.** Never mint a local user id; unknown attendees go through the auth service's shadow endpoint. Mirror rows are upserts keyed on the canonical id.
8. **API consumers get ids and names, never emails.** The API is read-only; service tokens are hashed at rest, constant-time compared, scope-checked.
9. **Every privileged mutation writes `audit_log`.** Sign-offs, revocations, module changes, lead changes, rule changes, token issuance, imports, recalculations.
10. **No automated sanction ever creates or destroys a record.** Crons may notify and digest; only humans (or the documented import) create records.

## Repo conventions

Drizzle schema in `server/db/schema/`, one file per domain area; migrations generated then hand-reviewed (D1 is SQLite — no `ALTER COLUMN`, column changes are table rebuilds). Zod on every request body/query. One route = one file under `server/api/`. Pages under `app/pages/`, `@nuxt/ui` components. Errors via `createError` — no internal detail. British English in UI copy and docs. Tests: every change to record creation, validity, sign-off gating, or eligibility evaluation needs a test that fails without the change.

## Things Claude Code should proactively flag

- Any code path that computes validity without going through `server/utils/validity.ts`.
- Any new mutation lacking an audit-log write where peers have one.
- Drift between `docs/api-reference.md` and actual routes.
- A schema change that would let a record exist without a traceable origin (`source` + `session_id`/`granted_by`).
