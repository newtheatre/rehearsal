# Operations Runbook

Procedures for whoever holds `training:ADMIN`, the Theatre Manager and the ITM. Written so a competent successor can operate from this document alone. Access needed: Cloudflare account (worker + D1), committee password manager, GitHub `newtheatre` org, the auth service admin (for role grants).

## Infrastructure

| Thing | Value |
|---|---|
| Cloudflare account | New Theatre: `3d250a94794003bd921b7f0379de7f00` |
| Worker | `rehearsal` |
| D1 database | `training`: `5c8fa8bf-74b3-4e56-bb01-5c34f45fc600` (WEUR), created 2026-08-14 |
| Repo | `newtheatre/rehearsal`, `main` deploys via Workers Builds |

### The custom domain is deliberately NOT configured yet

`training.newtheatre.org.uk` still points at the legacy Heroku app. Attaching it to this worker **is** the Phase 5 cutover, so the route is commented out in `nuxt.config.ts` and the worker serves its `workers.dev` URL until then. Uncomment it only when [migration.md](migration.md#4-cutover) says so: deploying with that route live would repoint the domain the moment the build finished, with no legacy grace period and no import done.

Until cutover the worker is reachable at `https://rehearsal.<account-subdomain>.workers.dev`, which is fine for smoke-testing but is **not** a login-capable environment: the session cookie is scoped to `.newtheatre.org.uk`, so SSO only works on the real domain.

## Deployments

CI on merge to `main` (Workers Builds). **Migrations now apply automatically**, from
`.github/workflows/migrate.yml` on any push to `main` that touches
`server/db/migrations/**`. Workers Builds only builds and deploys; nothing applied migrations until
this workflow existed, which took the whole estate down for an hour on 2026-08-19 when `stage-door`
shipped code against a schema six migrations behind (stage-door ADR-0021).

Every run records a D1 Time Travel restore point in its job summary **before** applying anything, and
gates on the `_hub_migrations` ledger afterwards rather than trusting the CLI's exit code. To see
what is pending without applying it:

```bash
CLOUDFLARE_ACCOUNT_ID=3d250a94794003bd921b7f0379de7f00 ./.github/scripts/pending-migrations.sh
```

The workflow needs a `CLOUDFLARE_API_TOKEN` repository secret with D1:Edit. It fails loudly if that
is missing rather than skipping the migration.

`GET /api/health` returns **503** naming the pending files if a deploy ever lands ahead of its
migration, so the gap is visible where uptime monitoring already looks.

Rollback = redeploy previous commit; migrations roll **forward** only. Before any migration touching
`records`: `npx wrangler d1 export training --remote --output backup-$(date +%F).sql`.

## Backups

Weekly `wrangler d1 export` to the R2 backups bucket (GitHub Actions cron), retained 8 weeks; monthly snapshots 12 months (personal data, retention applies to backups too). Annual restore drill at handover, logged in the estate tracker.

## Secrets inventory

| Secret | Where set | Where recorded |
|---|---|---|
| `NUXT_SESSION_PASSWORD` | Account **Secrets Store**, bound into this worker as `SESSION_PASSWORD` (shared estate secret, the auth service's runbook owns rotation) | Password manager → "NNT session seal" |
| `NUXT_RESEND_API_KEY` | This worker | Password manager |
| `NUXT_AUTH_SERVICE_TOKEN` | This worker (issued by the auth service) | Password manager |
| Training API tokens (one per consumer) | Consumer workers | Password manager, one entry per consumer |

The session seal is the one secret not set on this worker. It is shared estate-wide,
so it lives in the account Secrets Store (`fdfe08b6b01f498fbddbc08c2891cadb`) and is
bound in via `secrets_store_secrets` in `nuxt.config.ts`, then hydrated into
`runtimeConfig.session.password` by `server/plugins/0.secrets-store.ts`: read that
file's header before adding another binding, the binding name matters. Rotation is
central: stage-door `docs/operations.md`, ADR-0016. `wrangler secret list` will not
show it; `wrangler versions view <version-id> --name rehearsal` will.

## Service tokens <a name="service-tokens"></a>

Issue: `/admin` → API tokens → New (name = consumer app). Plaintext `nnt_trn_…` shown **once** → password manager + consumer's worker secret. Revoke the old row after the consumer redeploys. Rotate at handover and on suspicion. A stale `last_used_at` on an active consumer means misconfiguration: chase it.

## Content operations (no deploys involved)

| Task | How |
|---|---|
| New module / edit / activate / retire | Lead or admin → `/admin` → Modules. Retire, never delete: history FKs it. |
| Change expiry policy | Edit module → choose whether to run the recalc (default no, future awards only; recalc previews the diff and is audit-logged) |
| Attach materials | Module → Materials link (Drive URL; check the Drive file's own sharing is members-visible) |
| Change an eligibility rule | `/admin` → Rules → edit; audit-logged. **Tell the consuming app's owner**: semantics may matter to their UX copy. |
| Swap department leads | `/admin` → Leads (see handover) |
| Correct a record | Revoke with reason + re-grant. Never edit the DB by hand: records are append-only. |
| Record an external cert | Person page → Record external (lead/admin); type the certificate's own expiry |

## Notifications <a name="notifications"></a>

Daily cron 06:00 UTC (`expiry:sweep`). `site_config.notifications_mode`: ships `dry-run` (report emailed to admins, nothing sent to members); flip to `live` at `/admin/notifications` after reviewing the preview, and back to dry-run after any change to expiry config or the warning window. Idempotent per (record, type) via `notification_log`; running twice sends nothing new. Monthly digests (leads: own dept; TM+ITM: all) go out on the 1st. **The digest's absence is itself an alert**, if it doesn't arrive, check the cron.

Members get two warnings per record: one on entering the warning window (`warning_window_days`, default 60) and a final one 14 days out. Expired training is not emailed to the member, the warnings already went out, but it appears in the digest until it is renewed.

**A dry run records nothing as sent.** That is deliberate: flipping to live afterwards still delivers everything the dry run described, rather than silently swallowing a round of warnings. The same applies to a failed send: nothing is logged, so the next morning retries it.

**Preview before switching.** `/admin/notifications` shows exactly what the next sweep would do and takes an "as of" date, so you can ask what happens on 1 October without waiting for it. The preview sends and records nothing at all.

### Who receives the digest

Department leads get their own departments; `training:ADMIN` holders get everything. A cron has no session to read roles from, so admin-ness comes from `users.is_training_admin`, a cache refreshed whenever that person loads a page. **An admin who has never signed in to this app has no mirror row and gets no digest**: if a new TM says the digest never arrives, have them sign in once.

### Changing an expiry policy retroactively

Editing a module's expiry affects future awards only ([ADR-0002](decisions/0002-expiry-stamped-at-award.md)). To apply it to existing records, use `/admin` → recalculation: it previews the exact diff (person, module, old date → new date), requires the change count to be echoed back before applying, and audit-logs every row it moved. The apply is a single atomic batch with its audit entry inside it, so a run either moves every row and is logged, or moves none. It never touches `EXTERNAL` records, the issuing body's certificate date is not ours to rewrite, nor revoked or superseded ones.

## Annual handover checklist (add to the Archivist runbook)

1. Auth service: `training:ADMIN` to incoming TM + ITM; outgoing revoked after a two-week overlap.
2. `/admin` → Leads: swap `department_leads` rows to the new CTD/CWM/CSM/etc.
3. Trainer list: LEAD-CERT AY expiry (if ratified) forces the annual re-approval conversation: sign off the new-year trainers.
4. Confirm the `duty-manager` rule still matches committee policy; confirm expiry policies survived any summer catalogue changes.
5. Rotate: all training API tokens, `NUXT_AUTH_SERVICE_TOKEN`, Resend key.
6. Backup-restore drill; review a month of `audit_log`; read this doc top to bottom and fix drift.
7. Expect the 1 October induction rollover: everyone's induction expires 30 Sep **by design**. September's digest is the schedule-inductions warning shot.

## Incidents

**App down**, members can't view records; consumers degrade per their documented failure direction (rota: manager-confirmation fallback). Check Cloudflare status, `npx wrangler tail rehearsal`, recent deploys; roll back first, diagnose second. Nothing here is show-stopping within hours.

**Auth service down**: nobody logs in estate-wide (existing sessions keep working); the API keeps answering (token auth is local). See the auth runbook.

**Bad import / bad bulk grant**, records carry `source` and the import's batch id in `detail`; `/admin` → Imports → bulk-revoke by batch (revocation, not deletion, reversible by re-grant).

**Suspected token leak**: revoke the token row (consumer goes 401, which is its tested failure mode), issue a fresh one, review `audit_log` and worker logs. Read-only scope bounds the damage to disclosure of names/training states.

**A wrong safety record** (someone marked trained who wasn't): revoke immediately with reason; the department lead informs whoever relied on it (supervision lists, rota); check whether sibling records from the same session are also wrong.

**Escalation:** ITM → Theatre Manager → alumni IT admins (see estate tracker contacts). No on-call; the estate fails soft.

## Monitoring

`GET /api/health` on the uptime monitor. Termly glance: `audit_log` anomalies, token `last_used_at`, Resend bounces, digest arrival. The cron self-reports failures to the ITM by email.
