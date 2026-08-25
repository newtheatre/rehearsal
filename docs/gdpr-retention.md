# GDPR & Data Retention

The training system's slice of the theatre's data-protection posture. Same honest framing as the auth service's doc: compliance is mostly process; the committee's data-protection policy is in progress (target spring 2027); this doc makes the technical side ready. Not legal advice; SU guidance takes precedence.

## What personal data this app holds

| Data | Where | Basis (proposed) |
|---|---|---|
| Mirror rows (id, email, name) | `users` | Same as the auth account (contract) |
| Training records incl. safety-relevant history | `records` | Legitimate interest / H&S obligation: who was trained to do what is exactly the record a safety incident review needs |
| Session attendance | `session_attendees` | As above |
| No-show/interest data | v2 only, assessed then |, |
| Notification + audit metadata | `notification_log`, `audit_log` | Legitimate interest (operations) |

Data minimisation: nothing beyond id/email/name about a person; the free-text fields *about* people are `revoke_reason`, session `notes` and `external_ref` (which carries both an external certificate's reference and a sign-off note): all flagged to authors as visible-on-review, all in the anonymisation scrub list.

## Erasure: the estate hooks

This app implements the auth service's hook contract ([api-reference.md](api-reference.md#inbound-gdpr-hooks-called-by-the-auth-service)). Anonymisation rewrites the mirror row (`deleted-<id>@anonymised.invalid`, "Deleted user") and scrubs `revoke_reason`, `external_ref` and session `notes`; **records and attendance survive as anonymous rows**: training and safety statistics outlive the person, the same stance as bookings (stage-door ADR-0008). Idempotent; audit-logged.

The row is stamped `anonymised_at`, and `ensureLocalUser` will not write over a row carrying it. Without that, the person's sealed session cookie, valid for up to 30 days after the erasure, and read locally without revalidation, would restore their real name and email on their next request from any open tab.

Audit detail is **not** scrubbed, so nothing identifying may be written into it: `audit_log.detail` is searchable by substring from `/admin`, which would re-identify an anonymised row. Record ids and user ids only. Every mutation that takes free text (revoke, sign-off, external certificate, ad-hoc practice grant, declined request) keeps it in its own column and out of the detail; `tests/audit-detail.test.ts` is what holds that. Rows written before 2026-08-25 predate the rule being enforced, and clearing them is a hand-applied one-off ([known-issues.md](known-issues.md)).

One training-specific wrinkle: an anonymised *trainer* leaves sessions attributed to "Deleted user". Acceptable: the records those sessions produced remain valid; the evidence chain notes an anonymised trainer, which is true.

## Access

The `export` hook returns this app's contribution to a subject-access bundle: mirror row, all records (current and historical, with sources and dates), sessions attended, sessions signed up to, and sessions delivered. Assembled and delivered by the auth service's flow.

Practice windows are scratch: an anonymised person's `reason` text is scrubbed with the rest, and the windows themselves expire and close on their own.

Module requests are included too: the note somebody wrote asking for training is their own words about themselves.

`sessionsAttended` means attended. `sessionSignups` is every row held about them, including sessions they signed up to and did not turn up to, and the withdrawals: being marked absent is a fact recorded about a person, so it is disclosed rather than quietly filtered out of a legal document.

## Retention

- **Records**: kept while the account exists; anonymised (not deleted) when the auth service's erasure or inactivity sweep reaches the person. The sweep's `last-activity` hook answer from this app (latest record/session) correctly keeps active members out of the sweep.
- **Sessions/attendance**: same lifecycle as records.
- **`notification_log`**: pruned after 24 months (operational only).
- **Backups**: weekly/monthly cycle means erased data persists in encrypted backups up to 12 months: same documented ceiling as the rest of the estate.

Proposed periods ride the committee policy ratification; values live in config/docs, not code.
