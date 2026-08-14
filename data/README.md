# Catalogue data

## ⚠️ `catalogue.csv` is a placeholder

The committed file is **not** the backstage subcommittee's catalogue. It was
reconstructed from the module ids named across the design documents so that
Phase 1 has something real to render, seed and test against.

- Every row is `DRAFT`, so nothing in it is visible to ordinary members.
- Every row's *Notes* column says `PLACEHOLDER` and why.
- Names, descriptions, prerequisites and expiry policies are provisional.
  Only two things in it are stated in the source documents: that `TECH-211`
  requires `TECH-111` + `TECH-112`, and that `LEAD-CERT` confers trainer
  standing. Everything else is a guess with a plausible shape.
- `AV-CERT` and `SM-CERT` have no agreed names yet — the ones here are invented.
- The `STGE`, `COST` and `PROD` sheets were unfinished when this was written;
  they have one token module each.

**Replace the whole file** with the subcommittee's export, then:

```bash
bun run seed:catalogue
```

Re-running overwrites catalogue fields from the CSV, so treat the CSV as the
source of truth for a bulk import — but once the catalogue is live, ordinary
content changes belong in the admin UI, not here
([docs/operations.md](../docs/operations.md#content-operations-no-deploys-involved)).

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
