# Records & Expiry

**The semantics this app and every API consumer rely on.** Change this doc only with an ADR; the validity rules below are compiled into consumer behaviour (the rota's claim gating) just as surely as into our own pages.

## The record

A record says: *this person completed this module on this date, and here is the evidence chain.* Fields that matter semantically:

- `source` — `SESSION` (derived from a logged session, `session_id` set), `SIGNOFF` (manual certification/bootstrap grant, `granted_by` set), `EXTERNAL` (external certificate, `external_ref` documents it), `LEGACY` (the one-off import), `ADMIN` (other manual grant, discouraged, always with audit trail).
- `awarded_at` — the date the training happened (not the date of data entry).
- `expires_at` — stamped at creation ([ADR-0002](decisions/0002-expiry-stamped-at-award.md)); `NULL` = never expires.
- `revoked_at`/`revoked_by`/`revoke_reason` — the correction mechanism. Revoked records stay visible in history.

**Current record** for (user, module) = latest non-revoked row by `awarded_at` (ties: latest `created_at`). Re-training supersedes naturally: a new record with a fresh expiry becomes current; the old one remains as history.

## Expiry modes (per module, config not code)

| Mode | `expires_at` at award | Used for |
|---|---|---|
| `NONE` | `NULL` | Most skills modules |
| `MONTHS` (+ `expiry_months`) | `awarded_at` + N calendar months | e.g. powered tools (12), intimacy & fight (24) |
| `ACADEMIC_YEAR` | The next 30 September strictly after `awarded_at` | Induction, FOH management, committee training — "everyone redoes it each year" |
| *(external records)* | Typed in explicitly at recording, from the certificate itself | First Aid — the SU cert's own date wins |

`ACADEMIC_YEAR` is a fixed date, not a duration, so mid-year completions still expire with everyone else's — the 1 October mass-rollover of inductions is an emergent property, not special-case code. The boundary (`09-30`) lives in `site_config`.

Changing a module's expiry config affects **future records only**. The explicit admin "recalculate current records" action (previewed diff, typed confirmation, audit log) is the sole retroactive path.

## Validity states (derived, never stored)

```
VALID     expires_at IS NULL, or expires_at > today
EXPIRING  subset of VALID: expires_at within warning_window_days (site_config, default 60)
EXPIRED   expires_at <= today
```

One implementation: `server/utils/validity.ts` (util + SQL fragment). CLAUDE.md invariant 4.

**What validity gates:**

| Check | Counts |
|---|---|
| Eligibility rules (API) | VALID + EXPIRING |
| Certification sign-off prerequisites | VALID + EXPIRING |
| Trainer standing (`grants_trainer`) | VALID + EXPIRING |
| Directory / API listings | All, with state distinguished — held-but-expired is visible, never hidden |

EXPIRING counts as valid everywhere. It exists purely to drive warnings — a person's ability never flickers off early.

## Kinds

- **`MODULE`** — ordinary trained skill; everything above applies.
- **`CERTIFICATION`** — `signoff_required`; created only via the sign-off flow (or bootstrap). May set `grants_supervisor` (dept supervisor standing, display + future use) or `grants_trainer` (LEAD-CERT: unlocks session logging). A valid cert whose *constituent* modules have lapsed stays valid but is flagged on the person page — deliberate v1 stance; auto-suspension is a committee decision for later ([roadmap](roadmap.md)).
- **`BRIEF`** — recurring briefings (get-in/get-out briefs). Attendance is recorded per event (the sheet's "track get-in attendance" idea), display is *last received*, and BRIEF records never expire, never gate, and never appear in eligibility maths. They exist so the expiry machinery can't be abused to model something that recurs weekly.

## What the sweep does with these states

A daily cron (06:00 UTC) reads the states above and sends email. It never changes a record: expiry happens because the calendar moved, and the sweep merely notices (CLAUDE.md invariant 10).

| Trigger | Who hears | Once per |
|---|---|---|
| A record becomes EXPIRING | the member | (record, `expiry.window`) |
| A record falls inside 14 days | the member | (record, `expiry.14day`) |
| The 1st of the month | leads (own departments), admins (all) | (person, month) |

The two member warnings are independent: the gentle one having been sent never suppresses the urgent one. If the warning window is configured tighter than 14 days the first warning simply never fires, which is the correct reading of a 10-day window.

EXPIRED records are not emailed to the member — the warnings already went out before it lapsed — but they stay in the monthly digest until renewed. Briefs are excluded entirely.

Operational detail (dry-run semantics, who gets the digest, previewing a future date): [operations.md](operations.md#notifications).

## Worked examples

- Induction (`ACADEMIC_YEAR`) taken 12 Oct 2026 → expires 30 Sep 2027; taken 15 Sep 2027 → expires 30 Sep 2027 (fifteen days later — correct: that's what an academic-year gate means; run inductions in October, not September).
- First Aid recorded 1 Nov 2026 with cert dated to 3 Mar 2028 → `EXTERNAL`, expires 3 Mar 2028 regardless of module config.
- Trainer's LEAD-CERT (AY policy, if ratified) expires 30 Sep → their "log a session" ability greys out 1 Oct until re-approved; sessions they logged remain valid history.
