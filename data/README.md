# Catalogue data

## `catalogue.csv` is the subcommittee's draft catalogue

Loaded from *NNT Training Module Catalogue — Complete Draft* (10 Aug 2026): 57 modules
across the nine departments, including the eight certifications.

**Every row is `DRAFT`**, so nothing is visible to ordinary members and nothing gates
anything. That matches the source document, which is explicitly a draft for
subcommittee review with open decisions listed at the end. Publishing is per-module in
`/admin` → Modules once each is ratified.

Faithful to the document, deliberately:

- `safety_critical` is set only on the rows the draft marks ⚠ (`SFTY-012`, `SFTY-021`,
  `SFTY-022`, `TECH-201`, `STGE-201`, `MGMT-201`). The flag hard-blocks a session when
  prerequisites are missing, so it is not somewhere to be generous.
- `SFTY-012` is **not** a prerequisite of `TECH-111` — the draft flags that as a
  subcommittee call, so it stays unmade here.
- The 13 TECH modules have no `description`: the draft says their text is unchanged in
  the subcommittee's own spreadsheet and does not reproduce it. Their notes say so.
  Everything else carries the draft's own wording.
- Open questions from the draft (new modules to confirm, `AV-CERT`/`SM-CERT` naming,
  `LEAD-CERT` expiry, COST and PROD sign-off leads) are recorded in each module's
  `notes`, which are visible to leads and admins only.

Re-run after editing:

```bash
bun run seed:catalogue                                  # local
bun run scripts/catalogue-sql.ts > work/catalogue.sql   # production
npx wrangler d1 execute training --remote -c wrangler.d1.jsonc --file work/catalogue.sql
```

Both paths use the same parser, so they cannot describe the catalogue differently. The
SQL is idempotent and never deletes a module — modules are retired, not dropped, because
records reference them.

## Format

One row per module or certification; one CSV for all departments, with a
leading `Department` column.

| Column | Required | Notes |
|---|---|---|
| `Department` | yes | Department code. For certifications this is the department the cert belongs to (`LD-CERT` → `TECH`); for modules it must match the id prefix. |
| `ID` | yes | `DEPT-LCT` (`TECH-111`) or `XX-CERT` (`LD-CERT`). |
| `Name` | yes | Member-visible. |
| `Description` | | Member-visible. |
| `Prerequisites` | | Comma-separated ids; must resolve within the file. |
| `Old Module(s)` | | Legacy codes for the import mapping ([docs/migration.md](../docs/migration.md)). |
| `Proposed Expiry` | | `Never`, `Academic year`, `N months`, `N years`, `External cert date`, `Brief (recurring)`. Blank = Never. |
| `Materials Link` | | Drive URL; must be `https://`. |
| `Safety Critical` | | `yes`/`no`. |
| `Grants` | | `supervisor`, `trainer`, or both. Certifications only. |
| `Status` | | `DRAFT` (default), `ACTIVE`, `RETIRED`. |
| `Notes` | | Lead/admin-visible only. |

Unknown columns are ignored, so the subcommittee can keep their own working
columns in the sheet. **Unparseable cells are hard failures naming the cell** —
nothing is skipped silently.

`kind` is derived, not typed: an id ending `-CERT` is a `CERTIFICATION` (and
gets `signoff_required`), a `Brief (recurring)` expiry makes a `BRIEF`, and
everything else is a `MODULE`.
