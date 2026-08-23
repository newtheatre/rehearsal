# Records & Expiry

**The semantics this app and every API consumer rely on.** Change this doc only with an ADR; the validity rules below are compiled into consumer behaviour (the rota's claim gating) just as surely as into our own pages.

## The record

A record says: *this person completed this module on this date, and here is the evidence chain.* Fields that matter semantically:

- `source`: `SESSION` (derived from a logged session, `session_id` set), `SIGNOFF` (manual certification/bootstrap grant, `granted_by` set), `EXTERNAL` (external certificate, `external_ref` documents it), `LEGACY` (the one-off import), `ADMIN` (other manual grant, discouraged, always with audit trail).
- `awarded_at`: the date the training happened (not the date of data entry).
- `expires_at`: stamped at creation ([ADR-0002](decisions/0002-expiry-stamped-at-award.md)); `NULL` = never expires.
- `expiry_overridden`: the date came from a certificate or a signer rather than from policy, so the recalculation skips it ([ADR-0012](decisions/0012-explicit-expiry-marked-on-the-record.md)). It is also what makes a `NULL` readable: flagged means "explicitly never", unflagged means "policy says never".
- `revoked_at`/`revoked_by`/`revoke_reason`: the correction mechanism. Revoked records stay visible in history.

`EXTERNAL` is **opt-in per module**, and never available on a brief: a brief recurs per event, so nothing outside can evidence attending one, and `applyKindRules` clears the flag rather than trusting the form. `modules.allows_external` must be set, and `modules.external_evidence` says what the lead should accept ("FAW or EFAW certificate"). Without it the route refuses, so a certification conferring supervisor or trainer standing cannot be granted from an unverified certificate merely because the form offered it.

**Current record** for (user, module) = latest non-revoked row by `awarded_at` (ties: latest `created_at`). Re-training supersedes naturally: a new record with a fresh expiry becomes current; the old one remains as history.

### Where a `SESSION` record comes from

Two paths, and only two:

1. **The delivery log.** A trainer types up a session that has already happened, and the records are written in the same batch. This is the original path and it is unchanged.
2. **A marked register.** A scheduled session awards nothing until somebody marks its register, and then only for the people marked present ([ADR-0013](decisions/0013-a-scheduled-session-is-the-same-row.md), [scheduling-design.md](scheduling-design.md) §6).

Both stamp `awarded_at` from the session's `held_on` and compute expiry from module policy at that moment, so a record does not carry which path made it.

**Somebody marked absent gets nothing.** Not a record with a flag, not a revoked record: nothing at all. That is what makes the whole thing work, because every gate in the system already refuses a person who does not hold the module, and certification sign-off refuses them with no new code. It also means a no-show leaves no trace in `records`; the evidence that they were expected is the `ABSENT` row in `session_attendees`.

**Nothing on a timer ever marks a register.** A session whose date has passed unmarked has awarded nothing, and stays that way until a human does it; the daily sweep only nags them (CLAUDE.md invariant 10).

## Expiry modes (per module, config not code)

| Mode | `expires_at` at award | Used for |
|---|---|---|
| `NONE` | `NULL` | Most skills modules |
| `MONTHS` (+ `expiry_months`) | `awarded_at` + N calendar months | e.g. powered tools (12), intimacy & fight (24) |
| `ACADEMIC_YEAR` | The next boundary after `awarded_at`, or the one after that when the first is under 60 days away | Induction, FOH management, committee training: "everyone redoes it each year" |
| *(an override)* | Typed in explicitly at recording or sign-off | First Aid: the SU cert's own date wins; an assessor's own review date |

All dates are computed and displayed in `Europe/London` (`shared/utils/dates.ts`). The Worker runs in UTC, so an unpinned date is a day out for the first hour of every BST day, which would keep a lapsed record valid for that hour.

`ACADEMIC_YEAR` is a fixed date, not a duration, so completions still expire together rather than a year after each person's own award. The boundary (`08-31`) lives in `site_config`.

An award inside the last 60 days before that boundary runs to the **following** one instead ([ADR-0011](decisions/0011-academic-year-carry-over.md)), so no award is ever worth less than a term. This keeps the mode a fixed date: it chooses which boundary, never a duration. The consequence is that the 1 September rollover has two cohorts, and the people trained in the run-up to it are not in this year's.

Changing a module's expiry config, or the boundary itself, affects **future records only**. The explicit admin "recalculate current records" action (previewed diff, typed confirmation, audit log) is the sole retroactive path.

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
| Directory / API listings | All, with state distinguished: held-but-expired is visible, never hidden |

EXPIRING counts as valid everywhere. It exists purely to drive warnings: a person's ability never flickers off early.

## Kinds

- **`MODULE`**: ordinary trained skill; everything above applies.
- **`CERTIFICATION`**, `signoff_required`; created only via the sign-off flow (or bootstrap). May set `grants_supervisor` (dept supervisor standing, display + future use) or `grants_trainer` (LEAD-CERT: unlocks session logging). A valid cert whose *constituent* modules have lapsed stays valid but is flagged on the person page, deliberate v1 stance; auto-suspension is a committee decision for later ([roadmap](roadmap.md)).
- **`BRIEF`**: recurring briefings (get-in/get-out briefs). Attendance is recorded per event (the sheet's "track get-in attendance" idea), display is *last received*, and BRIEF records never expire, never gate, and never appear in eligibility maths. They exist so the expiry machinery can't be abused to model something that recurs weekly.

## What the sweep does with these states

A daily cron (06:00 UTC) reads the states above and sends email. It never changes a record: expiry happens because the calendar moved, and the sweep merely notices (CLAUDE.md invariant 10).

| Trigger | Who hears | Once per |
|---|---|---|
| A record becomes EXPIRING | the member | (record, `expiry.window`) |
| A record falls inside 14 days | the member | (record, `expiry.14day`) |
| The 1st of the month | leads (own departments), admins (all) | (person, month) |

The two member warnings are independent: the gentle one having been sent never suppresses the urgent one. If the warning window is configured tighter than 14 days the first warning simply never fires, which is the correct reading of a 10-day window.

EXPIRED records are not emailed to the member, the warnings already went out before it lapsed, but they stay in the monthly digest until renewed. Briefs are excluded entirely.

Operational detail (dry-run semantics, who gets the digest, previewing a future date): [operations.md](operations.md#notifications).

## Worked examples

- Induction (`ACADEMIC_YEAR`) taken 12 Oct 2026 → expires 31 Aug 2027; taken 20 Aug 2027 → expires 31 Aug **2028**, because the coming boundary is 11 days away and an 11-day induction is worth nothing.
- First Aid recorded 1 Nov 2026 with cert dated to 3 Mar 2028 → `EXTERNAL`, expires 3 Mar 2028 regardless of module config, flagged `expiry_overridden`.
- Signed off 1 Nov 2026 with the assessor's own review date of 1 Nov 2029 → stamped as given, flagged, and the recalculation will not move it.
- Trainer's LEAD-CERT (AY policy, if ratified) expires 31 Aug → their "log a session" ability greys out 1 Sep until re-approved; sessions they logged remain valid history.
