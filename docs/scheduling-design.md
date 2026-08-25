# Scheduling & sign-ups design

**Status: agreed, not yet built.** Drafted August 2026 by Matt Adcock (ITM 26/27). This is roadmap
item **R1**, landing in-repo as [roadmap.md](roadmap.md) said it would when picked up.

Read [records-and-expiry.md](records-and-expiry.md) first if you have not: everything here is
plumbing that ends in one act, a human marking a register, which is the only thing that creates a
record.

## 1. What this is, and what it is not

Today a `sessions` row is written **after** training has happened, and writing it awards the records
in the same batch. That is the whole of the delivery log, and it works: a lead teaches six people
how to use the fly floor, then types it in.

What it cannot do is anything **before** the teaching:

- A lead cannot say "TECH-111 is on Thursday at 6" anywhere a member will see it.
- A member cannot say "I would like to be taught TECH-111", so demand is invisible and sessions get
  scheduled on a hunch or on whoever shouted loudest in a committee meeting.
- A member cannot sign up, so a lead finds out who is coming when they arrive.
- Nobody is reminded, so people forget, and a session with two attendees costs the same evening as
  one with ten.

This design adds all four, and one consequence of them: **a person who signed up and did not turn
up gets nothing**, which is the point, plus a note saying we missed them.

**Not in scope:** room booking (that is `rooms`, and the tie-in here is a pasted link, nothing
more), recurring or templated timetables, a term planner, per-session materials (Drive owns content,
and that rejection stands), payment of any kind, and anything that decides *for* a lead whether a
session should run.

## 2. The shape of it

**A scheduled session and a delivered session are the same row.** `sessions` gains a lifecycle
instead of a second table.

```
PLANNED ──open sign-ups──▶ OPEN ──at capacity──▶ FULL
   │                         │                     │
   │                         └──register marked────┴──▶ DELIVERED
   │                                                       ▲
   │                                       (the retrospective path enters here)
   └──────────────── CANCELLED ◀────────────────────────────
```

Two things follow, and they are the reason for the choice:

1. **The retrospective path is untouched.** A lead who taught something on Tuesday and is typing it
   in on Wednesday uses exactly the screen and the endpoint they use today, and the row they create
   is born `DELIVERED`. Scheduling is opt-in. If the whole of this design were switched off tomorrow
   the delivery log would carry on working.
2. **There is one place to look.** "Was TECH-111 taught in October?" is one query against one table
   whether it was planned six weeks out or written up the next morning. A parallel `planned_sessions`
   table would have to be reconciled with the real one forever, and the two would drift the first
   time somebody scheduled a session and then logged it by hand because they forgot it was there.

There is deliberately **no `RUNNING` state**. The fact that matters on the day is
`register_opened_at`: it is what opens practice windows (§7), and it is a timestamp rather than a
state because a lead who opens the register and then closes their phone has not changed what the
session *is*. Status stays `OPEN` or `FULL` until the register is submitted.

## 3. Domain model

Additive throughout. Nothing existing changes meaning.

```
sessions            (existing) id · held_on · trainer_user_id · location · notes · created_by
                    status ('PLANNED'|'OPEN'|'FULL'|'DELIVERED'|'CANCELLED')  DEFAULT 'DELIVERED'
                    starts_at NULL · ends_at NULL      -- wall-clock; held_on stays the ISO date
                    capacity INTEGER NULL              -- NULL is uncapped; max 60, see §5.3
                    signups_close_at NULL
                    register_opened_at NULL            -- stamped on the day; opens practice (§7)
                    delivered_at NULL                  -- stamped when the register is submitted
                    cancelled_at NULL · cancel_reason TEXT NULL
                    description TEXT NULL              -- what to bring, where to meet

session_attendees   (existing) id · session_id · user_id
                    status ('SIGNED_UP'|'CANCELLED'|'ATTENDED'|'ABSENT') DEFAULT 'ATTENDED'
                    signed_up_at NULL · source ('SELF'|'LEAD')
                    marked_at NULL · marked_by_user_id NULL
                    -- no WAITLISTED: a place is derived from signed_up_at order (§5.2)

module_requests     id · user_id · module_id · note TEXT NULL
                    status ('OPEN'|'SCHEDULED'|'WITHDRAWN'|'DECLINED')
                    resolved_session_id NULL · resolved_at NULL · resolved_by NULL
                    decline_reason TEXT NULL · created_at
                    -- partial unique (user_id, module_id) WHERE status = 'OPEN'

practice_targets    key TEXT PK        -- 'bar-till'; a consumer hardcodes this, so never rename one
                    name · description · consumer TEXT
                    module_ids JSON    -- teaching any of these opens this sandbox
                    grace_hours INTEGER NULL
                    status ('ACTIVE'|'RETIRED') · updated_by · updated_at

practice_windows    id · user_id · target_key · session_id NULL
                    opened_by · opens_at · expires_at
                    closed_at NULL · closed_by NULL · reason TEXT NULL
```

`notification_log` gains a nullable `session_id`, so the emails below reuse the existing idempotency
ledger rather than growing a second one.

### 3.1 Why both defaults are what they are

`sessions.status` defaults to `DELIVERED` and `session_attendees.status` defaults to `ATTENDED`.
Neither is the value a *new* scheduled row will carry: those are always passed explicitly. The
defaults exist for two reasons, and both matter.

**They backfill correctly.** Every row that exists today is a delivered session whose attendees were
present. The migration needs no `UPDATE` pass, which on D1 is the difference between an `ADD COLUMN`
and a table rebuild ([the schema-change checklist](data-model.md#schema-change-checklist)).

**They fail in the safe direction.** If a future writer forgets to set the status, the row it creates
looks like something already finished rather than an open sign-up sheet nobody is watching. A
forgotten `DELIVERED` is visible immediately in the log; a forgotten `OPEN` is a session members can
join that no lead knows exists.

### 3.2 Attendance and sign-up are one column, not two tables

`session_attendees` carries both "I am coming" and "you were here". Splitting them into
`session_signups` and `session_attendees` would create two tables that must agree about the same
person, and a rule for what it means when they do not. This repo already has a rule about that
([CLAUDE.md](../CLAUDE.md) invariant 4): two implementations of one question is how safety systems
lie. One row per person per session, with a state.

### 3.3 A place is derived, not stored

There is no `WAITLISTED` status and no position column. Everybody who signs up is `SIGNED_UP`, and
whether they hold a place is `signed_up_at` order against `capacity`, worked out at read time by one
helper.

Storing it would mean reading a count and then writing a status, which two people signing up at the
same moment can both pass, handing out the last place twice. A position column would have to be
renumbered on every withdrawal, and a renumbering that half-fails leaves two people third with no
way to tell which is right. Deriving it has neither problem, and withdrawal promotes the next person
by arithmetic rather than by an `UPDATE`.

`sessions.status = 'FULL'` survives as a **cached badge** so the schedule list can say "full" without
counting rows per session. It is recomputed on every sign-up, withdrawal **and capacity change**, and
**nothing authoritative reads it**: a sign-up decides on the live count, never on the badge. If it
ever disagrees with the count, the count is right.

Recomputing it on a capacity change matters more than it looks: the badge is what members see, so a
stale `FULL` on a session that now has room reads as "waitlist" and suppresses exactly the sign-ups
the lead just made room for. A wrong badge is self-reinforcing, because the write that would heal it
is the sign-up it is discouraging.

## 4. Requesting a module

Any member may ask to be taught anything `ACTIVE` in the catalogue. A request is a demand signal and
nothing else: it creates no obligation, no queue position and no promise.

- One open request per person per module, held by a partial unique index rather than by a check in
  the handler.
- A member sees their own requests and may withdraw one.
- A department lead sees a **demand board** for their departments: modules ordered by open request
  count, with the names, so "six people want TECH-111 and four of them are new this term" is a
  glance rather than a spreadsheet.
- Scheduling a session that teaches a requested module offers to resolve the matching requests to
  `SCHEDULED` and links them to it. The requesters are told.
- A lead may `DECLINE` a request with a reason (the module is retired in practice, the person needs a
  prerequisite first, the kit is broken). Declining is a reply, not a rejection, and the copy should
  read like one.

Requests are never resolved automatically by anything on a timer. A request that nobody acts on stays
open and keeps showing up on the board, which is the entire point of it.

## 5. Scheduling and sign-up

### 5.1 Scheduling

A trainer or department lead schedules a session: modules, date, start and end, location (free text,
or a pasted `rooms` link), capacity, description, and when sign-ups close. It is created `PLANNED`
and is **invisible to members** until sign-ups are opened, so a half-finished plan is not an
advertisement.

Opening sign-ups moves it to `OPEN` and it appears on the schedule.

### 5.2 Signing up

Any member may sign up to an `OPEN` session. Prerequisites are checked at sign-up with the **same**
`checkSessionPrerequisites()` the delivery log uses, and behave the same way:

- a missing prerequisite for a **safety-critical** module blocks the sign-up, naming what is missing;
- anything else warns, and the member may sign up anyway.

That is deliberate symmetry. A trainer may teach past a warning because they know why; a member may
sign up past one because the gap may well be closed by Thursday. Neither can walk past a
safety-critical gap.

Sign-up never fails for being full. Past capacity a member joins the waitlist, is told so plainly,
and is told their position. A withdrawal moves everybody behind it up one, and whoever crosses into
a place is emailed; that is arithmetic on `signed_up_at` rather than a status change, so there is
nothing to go wrong halfway (§3.3).

A lead may add someone directly, including a walk-in with no account. Unknown people go through the
auth service's shadow endpoint: this app never mints a user id ([CLAUDE.md](../CLAUDE.md)
invariant 7).

### 5.3 Capacity is capped at 60, and the register at 200

Two different limits, and conflating them is a trap worth naming.

**Capacity** is the largest number a lead may *set*, capped at 60. It bounds nothing on its own: a
session may be uncapped (`capacity: null`), sign-up never refuses for being full so the waitlist
grows past it, and a lead may add walk-ins.

**The register** is what actually gets submitted, and it is capped at 200
(`MAX_REGISTER`). Submitting one writes a statement per attendee per module in a single `db.batch()`
([ADR-0009](decisions/0009-atomic-writes-use-batch-not-transactions.md)), so it cannot be unbounded.
The register route checks its own size *before* parsing the body, so an over-long register is
refused with something a lead can act on ("split the session") rather than a bare validation error.

The two must never be set to the same number. If they were, an uncapped session or a single walk-in
past capacity would produce a register that can never be submitted, which means nobody who attended
ever gets a record and there is no way to recover: sign-ups cannot be withdrawn from the outside and
only this route awards.

### 5.4 Cancelling

A lead may cancel an `OPEN` or `FULL` session with a reason. Everyone signed up is emailed. No
records are created and none are touched. A cancelled session stays in the list, visibly cancelled,
because "why did that not happen" is a question people ask in March about something in October.

## 6. The register, which is the only thing that creates a record

On the day, the lead opens the register. This stamps `register_opened_at` and opens practice windows
(§7). **Both opening and marking are refused with a 409 while `held_on` is still in the future**, and
that is enforced, not merely expected: records are stamped with `held_on`, so marking a register
early would award training dated next week that every gate reads as held today, and opening one
early would hand everybody signed up a live practice window for the whole intervening period. A
session taught earlier than planned is moved to today through `PUT /api/sessions/:id/schedule`
first, which the refusal says. The register is a phone screen: the sign-up list, one big control per person, present or
absent, plus a way to add someone who turned up unannounced.

**The marks must match the register exactly**, in both directions. A mark naming somebody no longer
signed up is refused, and so is a register entry with no mark: a partial submission would otherwise
deliver the session and leave that person with no record, no absence and no email, invisible to the
nag because the session is now delivered. The refusal names who was missed.

Submitting it is the record-creating act:

1. Prerequisites are checked once more, over the **present** cohort only. Safety-critical gaps still
   block: someone can sign up in October and lose a prerequisite to expiry before the session runs.
2. Everyone present is marked `ATTENDED`, everyone else `ABSENT`.
3. Records are built by `buildRecordInserts({ source: 'SESSION', awardedAt: held_on })` for the
   **present cohort only**, with expiry stamped exactly as it is today
   ([ADR-0002](decisions/0002-expiry-stamped-at-award.md)).
4. The session becomes `DELIVERED`, practice windows close, and the audit log is written.

All of that is one batch. The absentee emails are sent after it, never inside it.

**Submitting twice is refused.** A `DELIVERED` session cannot be re-submitted; a double-tapped
button, a retried request or a second lead on a second phone must not be able to award the same
training twice. The status check is a read taken several round trips before the write, so it
catches the ordinary cases but not two genuinely simultaneous submissions. The partial unique
index `records_session_award_unq` ([data-model.md](data-model.md#records)) is what catches those:
the losing batch aborts whole and its request is answered `409`. Corrections after the fact go through the existing edit window and, past it,
revocation plus a new grant, unchanged ([ADR-0008](decisions/0008-records-revoked-never-deleted.md)).

### 6.1 Not attending

Someone marked absent gets **no record**, and therefore does not hold the module, and therefore
cannot be signed off on any certification requiring it. That is not a new rule and needs no new code:
the hard prerequisite check on certification sign-off already refuses. It is worth stating plainly
because it is the requirement that motivated the whole feature.

They also get an email, and its tone is load-bearing. It says we are sorry we missed them, names what
was therefore not recorded, and links to the next session teaching it. It does **not** tell them off,
does not use the word "failed", and does not imply anything about their standing. The same rule
already governs the expiry warnings and it exists because these emails go to volunteers who are here
for fun.

### 6.2 The unmarked register

The commonest failure of any register system is a session that happened and was never marked, which
silently means nobody got their record. A daily task nags the lead of any session whose date has
passed with an unmarked register, and keeps nagging.

**The nag never creates or destroys a record.** It emails a human, who marks the register.
([CLAUDE.md](../CLAUDE.md) invariant 10.)

## 7. Practice windows

Some training is about operating a system in another app, and reading about the bar till is not the
same as using one. `practice_windows` is this app's answer to a consumer app asking: **is this person
being taught this, right now?**

It is not an eligibility question and does not share a table with one. See
[ADR-0014](decisions/0014-practice-targets-are-data.md), which is the whole argument; the short
version is that `bar` *requires* the general induction, and teaching the general induction must not
hand a fresher the till.

- **`practice_targets`** says which modules have a sandbox and what it is called. It is
  committee-editable data in the admin UI, beside the eligibility rules, and it is empty until
  somebody fills it in. Most modules are in no target, so most sessions open nothing.
- Opening a register inserts one window per signed-up attendee for each `ACTIVE` target whose modules
  the session teaches, expiring at the session end plus a grace period. The register page says which
  sandboxes it opened, or that these modules have none, so a lead is never guessing.
- A lead may also open one by hand for a named person, for coaching outside a scheduled session. Same
  table, `session_id` null, a reason required.
- Submitting the register closes them. So does the expiry, so does a lead closing one early, and so
  does a daily sweep for anything left behind.

`GET /api/v1/practice/:key` answers, for a service token. **It is `no-store`**, unlike the
five-minute eligibility cache: a window a lead just closed has to stop answering true immediately, or
the consumer's sandbox outlives the lesson.

What a consumer does with the answer is entirely its business, exactly as with eligibility
([ADR-0006](decisions/0006-eligibility-rules-as-data.md)). This app does not know what a sandbox is.

## 8. Email

All of it goes through the existing `sendEmail()` and `layout()` in `server/utils/email.ts`, and all
of it obeys the copy rule already written there: a nudge, never a disciplinary notice.

| Email | Trigger | Bulk? |
|---|---|---|
| Sign-up confirmed | member signs up | no |
| Moved off the waitlist | a withdrawal moved them into a place | no |
| Session cancelled | lead cancels | no |
| Session tomorrow | daily task | **yes** |
| Sorry we missed you | register submitted, marked absent | no |
| Your register is unmarked | daily task | **yes** |

### 8.1 `notifications_mode` gates bulk sends, not transactional ones

`site_config.notifications_mode` is the dry-run switch that stops the expiry sweep from emailing the
whole theatre while it is being tuned. The reminder and the nag are sweeps and respect it.

The other four **send regardless**, because they are the direct consequence of something a human just
did. Withholding a sign-up confirmation because a switch is set for an unrelated cron would make the
app look broken to the member who just pressed the button, and there would be nothing anywhere to say
why. This is a real divergence from how notifications behave today, so it is written here, in
[operations.md](operations.md) and nowhere else, because a comment cannot carry it.

Idempotency for the two bulk sends is the existing `notification_log`, keyed on the new `session_id`.

## 9. Permissions

No new manifest permissions.

| Action | Who |
|---|---|
| See the schedule, sign up, withdraw, request a module | any member |
| Schedule, open, cancel, mark a register, add an attendee | trainer or department lead (`requireTrainer`) |
| Open or close a practice window by hand | trainer or department lead |
| Edit `practice_targets` | `config.manage` |
| See the demand board | department lead, for their departments; admin for all |

Trainer standing is still derived from a valid certification at request time
([ADR-0004](decisions/0004-trainer-standing-from-records.md)) and leadership is still app data
([ADR-0005](decisions/0005-department-leads-as-data.md)). Scheduling is not a new kind of authority,
it is the authority that already exists applied a fortnight earlier.

## 10. Build order

Each stage is independently shippable.

1. **Schema and sign-ups.** The migration, scheduling, opening, signing up, the waitlist, withdrawal,
   cancellation, the upcoming list and the session page, and their four transactional emails. No
   register yet: a session scheduled in this stage is still marked up the old way.
2. **The register.** Opening it, marking it, creating records for those present, the "sorry we missed
   you" email, and the unmarked-register nag. This is the stage that changes how records are created,
   so it carries the tests.
3. **Module requests** and the demand board.
4. **Practice targets and windows**, `GET /api/v1/practice/:key`, and issuing Proscenium a token.

## 11. Open questions

- **Should a member be able to see who else has signed up?** Useful for lifts and for nerve. It is
  also a list of names, and the door screens elsewhere in the estate are careful about those. Default:
  count only, names to the lead. Revisit if anybody asks.
- **How long is the practice grace period?** Starting at four hours after the session ends, as
  config, because nobody knows yet whether people practise during a session or after it.
- **Should a repeated no-show do anything?** Deliberately not, in v1. It is a committee question about
  people, not a system question, and this app does not sanction
  ([CLAUDE.md](../CLAUDE.md) invariant 10). The data to answer it will exist for the first time after
  a term of this, which is the right order.
- **ICS attachments on the confirmation and reminder.** Cheap and obviously wanted; deferred to keep
  stage 1 small. Proscenium has a working `ics.ts` to copy.
