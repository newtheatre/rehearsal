# Migration: catalogue seed, legacy import, cutover

The one-off work that populates the system and retires the legacy Django app. **Historical after cutover**: kept because it explains why the data looks as it does (`LEGACY` records, `legacy_module_map`) and as the template for any future content import.

## 1. Catalogue seed

`scripts/seed-catalogue.ts` parses the completed subcommittee spreadsheet (*Training Modules 2* format: ID / Name / Description / Prerequisites / Old Module(s) / Proposed Expiry / Materials Link / Notes / Change) into `departments`, `modules`, `module_prerequisites`, `legacy_module_map`. Status: subcommittee-confirmed sheets → `ACTIVE`, still-draft → `DRAFT`. Expiry config from the Proposed Expiry column (`Never`/`Academic year`/`N months`/`External cert date`/`Brief (recurring)` → mode mapping); materials links pass through. **Unparseable cells are hard failures naming the cell**, no silent skips. The same parser backs `db:seed` for dev, so fixture drift is impossible.

Input file: `data/catalogue.csv` (export the spreadsheet's sheets to one CSV with a leading `Department` column).

Re-running an import **syncs content but never touches `status`**. Publishing and retiring are operational decisions made in `/admin`, so a regeneration of the catalogue must not unpublish what a lead activated. Each generated file also carries one `catalogue.import` row for `audit_log`, keyed on a hash of the CSV, so applying the same file twice records one entry rather than two and a later "why did the catalogue change?" has a trail.

> ⚠️ **The committed `data/catalogue.csv` is a placeholder.** It was reconstructed from the module ids named across the design documents so that Phase 1 has something to render; it is **not** the subcommittee's catalogue. Names, descriptions, prerequisites and expiry policies in it are provisional and every row is `DRAFT`. Replace the whole file with the real export before the system carries any weight, then re-run `bun run seed:catalogue`. The open content questions (unfinished `STGE`/`COST`/`PROD` sheets, unnamed `AV-CERT`/`SM-CERT`, per-module expiry ratification) belong to the backstage subcommittee, not to IT.

## 2. Legacy archive

`pg_dump -Fc` of Heroku `nnt-training` Postgres → the Archive shared drive, plus a local restore test. **This dump is the historical record we keep**: future "did X ever train?" questions about the old scheme go to the Archivist, not a live system.

## 3. Import proposal → review → import

1. `scripts/legacy-map.ts` reads the dump: each person's completed legacy modules × `legacy_module_map` → proposed grants, emitted as `work/import-review.csv` (person, email, legacy evidence with dates, proposed modules). A grant is proposed only when **all** legacy modules mapped to a new module are held; partial coverage lands in a separate column for human judgement.
2. **Review** by the relevant department leads with the subcommittee: keep/drop per row, definitive email per person (Workspace address where known). "Active member" = whoever survives review: expect tens of rows; hand-review is proportionate.
3. `scripts/import-legacy.ts` ingests the reviewed CSV: match-or-shadow users via the auth service (by email), insert `LEGACY` records (`awarded_at` = legacy session date where known, else import date; expiry stamped normally, a 2019 induction arrives already EXPIRED, which is correct), one import batch id in every `audit_log` detail (enables bulk-revoke). Asserts, committed to the PR: rows in = records out + named skips; zero unknown modules; zero users without canonical ids.

**Certifications are never imported**, they are new constructs. Leads fast-track deserving people via sign-off (`SIGNOFF` source: honest provenance).

## 4. Cutover

Deploy worker → repoint `training.newtheatre.org.uk` DNS from Heroku to Cloudflare → smoke test (login, catalogue, a real session log) → Heroku dyno to zero for a two-week grace → delete app + Postgres add-on after re-verifying the archived dump restores → archive the `nt-training` GitHub repo → update the IT Estate Tracker (Heroku line drops; coordinate with the legacy-ticketing Heroku exit so the account closes once).

Rollback before DNS: nothing happened. After DNS, within grace: repoint back, scale the dyno up. After Heroku deletion: the new system stands alone, which is why the grace period and the restore test both exist.
