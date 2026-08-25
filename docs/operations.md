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

Two daily crons: the expiry sweep at 06:00 UTC (`expiry-sweep`) and the session sweep at 09:00 UTC (`session-sweep`). Nitro registers a task under its **file path**, not its `meta.name`, and every cron expression in `scheduledTasks` also needs an entry in `nitro.cloudflare.wrangler.triggers.crons`; miss either and the task exists and never fires, with no error anywhere.

### The session sweep

Sends tomorrow's reminders (`session_reminder_days`, default 1) and nags the lead of any session whose date has passed with an **unmarked register** (`register_nag_days`, default 2, then weekly). An unmarked register means nobody got a record, so the nag is the safety net for the commonest failure this feature has. It never marks anything itself.

Both are idempotent through `notification_log`, now keyed on `session_id` as well. The sweep also closes any practice window left open past its expiry, which is housekeeping rather than a notification and so runs whatever the mode.

### Practice targets <a name="practice-targets"></a>

`/admin/practice-targets` decides which modules open a sandbox in a consumer app ([ADR-0014](decisions/0014-practice-targets-are-data.md)). **It ships empty, and that is the safe state**: with no targets, no session opens anything.

Creating one is committee policy expressed as data, so it needs no deploy here or in the consumer. Three things to know before editing:

- **Never rename a key.** A consumer hardcodes it; renaming turns their sandbox into a loud 404. Retire and create instead.
- **The module list is what teaching opens the sandbox**, not what somebody needs to be allowed near it. Do not copy an eligibility rule's `requires` into it: `bar` requires the general induction, and putting the induction here would open the till to every fresher taught it.
- **Retiring a target closes nothing by itself**, but open windows on it stop answering immediately, because the endpoint checks the target's status as well as the window's.

To set up Proscenium's training modes you need `bar-till`, `challenge-25` and `door-scan`, with the ADMN modules the bar design names, plus a service token for Proscenium.

Ad-hoc windows (a lead coaching somebody outside a scheduled session) are opened from the session screens and always carry a reason. Everything open right now is listed on the same admin page.

### Which emails the dry-run switch actually gates

`site_config.notifications_mode` gates the **sweeps**, both of them. It does not gate the transactional session emails: sign-up confirmations, waitlist promotions, cancellations and "sorry we missed you" send regardless, because each is the direct consequence of something a person just did and withholding one would make the app look broken with nothing anywhere to say why ([scheduling-design.md](scheduling-design.md) §8.1).

So flipping to dry-run silences the expiry warnings, the digests, the session reminders and the register nags, and nothing else.

### The expiry sweep

Daily cron 06:00 UTC (`expiry:sweep`). `site_config.notifications_mode`: ships `dry-run` (report emailed to admins, nothing sent to members). The dry-run report lists every warned member by name with the modules they hold, so it goes to the same freshly-cached admins the digest does, and an outgoing officer drops out of it on the same `admin_cache_days` window; flip to `live` at `/admin/notifications` after reviewing the preview, and back to dry-run after any change to expiry config or the warning window. Idempotent per (record, type) via `notification_log`; running twice sends nothing new. Monthly digests (leads: own dept; TM+ITM: all) go out on the 1st. **The digest's absence is itself an alert**, if it doesn't arrive, check the cron.

Monthly digests go to department leads (their own department) and to training admins (everything). Admin scope comes from a cached flag with no revocation path, so it is honoured only while the person has used the system inside `site_config.admin_cache_days` (default 90). **After a committee handover, an outgoing officer stops receiving the unscoped digest once that window passes**, and sooner if you clear the flag by hand.

Members get two warnings per record: one on entering the warning window (`warning_window_days`, default 60) and a final one 14 days out. Expired training is not emailed to the member, the warnings already went out, but it appears in the digest until it is renewed.

**A dry run records nothing as sent.** That is deliberate: flipping to live afterwards still delivers everything the dry run described, rather than silently swallowing a round of warnings. The same applies to a failed send: nothing is logged, so the next morning retries it.

**Preview before switching.** `/admin/notifications` shows exactly what the next sweep would do and takes an "as of" date, so you can ask what happens on 1 September without waiting for it. The preview sends and records nothing at all.

### Who receives the digest

Department leads get their own departments; `training:ADMIN` holders get everything. A cron has no session to read roles from, so admin-ness comes from `users.is_training_admin`, a cache refreshed whenever that person loads a page. **An admin who has never signed in to this app has no mirror row and gets no digest**: if a new TM says the digest never arrives, have them sign in once.

### Changing an expiry policy retroactively

**External certificates are opt-in per module.** Nothing may be recorded from an outside certificate until a lead ticks "Allow external certification" on the module and writes what evidence is accepted. Existing modules default to off, so after this ships someone has to enable it on the ones that need it (First Aid is the obvious one). Until then the recorder's module list is empty and the API returns 400.

**Break-glass: an expiry that never expires.** `POST /api/people/:id/signoff` accepts `neverExpires: true`, which needs `record.manage` and is deliberately absent from the UI. It exists for one situation: a certification the system depends on has lapsed, and nobody holds it, so no one can sign it back. The bootstrap Trainer certification is the worked example, since without it no session can be logged at all. It is audit-logged like any other sign-off and shows on the person's page. It should stay rare: if a module should never expire, that is module policy, not a per-record decision.

Editing a module's expiry affects future awards only ([ADR-0002](decisions/0002-expiry-stamped-at-award.md)). To apply it to existing records, use `/admin` → recalculation: it previews the exact diff (person, module, old date → new date), requires the change count to be echoed back before applying, and audit-logs every row it moved. The apply is a single atomic batch with its audit entry inside it, so a run either moves every row and is logged, or moves none. It never touches records whose expiry was set explicitly, whether that came from an external certificate or from a signer, nor revoked or superseded ones. The count is reported as `skippedOverridden`.

### One-off: scrubbing free text out of historical audit detail

Five mutations wrote a person's free text into `audit_log.detail` as well as into its own column: `record.revoke` (`reason`), `record.signoff` (`note`), `record.external` (`externalRef`), `practice-window.grant` (`reason`) and `request.decline` (`reason`), and `lead.add` wrote a real name. The handlers no longer do, but rows written before that keep the text, and `audit_log` has no update path in the app: an erasure scrubs the column and cannot reach the copy, so a substring search from `/admin` still re-identifies the person.

Clearing them is a hand-applied, destructive change, run before the fix is merged and never from CI. Take an export first (`npx wrangler d1 export training --remote --output backup-$(date +%F).sql`), then strip the keys from the detail JSON, leaving the id-shaped fields alone:

```sql
UPDATE audit_log SET detail = json_remove(detail, '$.reason')
  WHERE action IN ('record.revoke', 'practice-window.grant', 'request.decline')
    AND json_extract(detail, '$.reason') IS NOT NULL;
UPDATE audit_log SET detail = json_remove(detail, '$.note')
  WHERE action = 'record.signoff' AND json_extract(detail, '$.note') IS NOT NULL;
UPDATE audit_log SET detail = json_remove(detail, '$.externalRef')
  WHERE action = 'record.external' AND json_extract(detail, '$.externalRef') IS NOT NULL;
UPDATE audit_log SET detail = json_remove(detail, '$.name')
  WHERE action = 'lead.add' AND json_extract(detail, '$.name') IS NOT NULL;
```

Check the row counts each statement reports against a `SELECT count(*)` run beforehand, and record the date it was run here. Until it has been, the gap is [known-issues.md](known-issues.md).

## Annual handover checklist (add to the Archivist runbook)

1. Auth service: `training:ADMIN` to incoming TM + ITM; outgoing revoked after a two-week overlap.
2. `/admin` → Leads: swap `department_leads` rows to the new CTD/CWM/CSM/etc.
3. Trainer list: LEAD-CERT AY expiry (if ratified) forces the annual re-approval conversation: sign off the new-year trainers.
4. Confirm the `duty-manager` rule still matches committee policy; confirm expiry policies survived any summer catalogue changes.
5. Rotate: all training API tokens, `NUXT_AUTH_SERVICE_TOKEN`, Resend key.
6. Backup-restore drill; review a month of `audit_log`; read this doc top to bottom and fix drift.
7. Expect the 1 September induction rollover: everyone's induction expires 31 Aug **by design**. August's digest is the schedule-inductions warning shot. Anyone trained in the preceding 60 days is not in this year's rollover, by design ([ADR-0011](decisions/0011-academic-year-carry-over.md)).

## Incidents

**App down**, members can't view records; consumers degrade per their documented failure direction (rota: manager-confirmation fallback). Check Cloudflare status, `npx wrangler tail rehearsal`, recent deploys; roll back first, diagnose second. Nothing here is show-stopping within hours.

**Auth service down**: nobody logs in estate-wide (existing sessions keep working); the API keeps answering (token auth is local). See the auth runbook.

**Bad import / bad bulk grant**, records carry `source` and the import's batch id in `detail`; `/admin` → Imports → bulk-revoke by batch (revocation, not deletion, reversible by re-grant).

**Suspected token leak**: revoke the token row (consumer goes 401, which is its tested failure mode), issue a fresh one, review `audit_log` and worker logs. Read-only scope bounds the damage to disclosure of names/training states.

**A wrong safety record** (someone marked trained who wasn't): revoke immediately with reason; the department lead informs whoever relied on it (supervision lists, rota); check whether sibling records from the same session are also wrong.

**Escalation:** ITM → Theatre Manager → alumni IT admins (see estate tracker contacts). No on-call; the estate fails soft.

## Monitoring

`GET /api/health` on the uptime monitor. Termly glance: `audit_log` anomalies, token `last_used_at`, Resend bounces, digest arrival. The cron self-reports failures to the ITM by email.
