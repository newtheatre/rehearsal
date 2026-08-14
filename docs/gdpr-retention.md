# GDPR & Data Retention

The training system's slice of the theatre's data-protection posture. Same honest framing as the auth service's doc: compliance is mostly process; the committee's data-protection policy is in progress (target spring 2027); this doc makes the technical side ready. Not legal advice; SU guidance takes precedence.

## What personal data this app holds

| Data | Where | Basis (proposed) |
|---|---|---|
| Mirror rows (id, email, name) | `users` | Same as the auth account (contract) |
| Training records incl. safety-relevant history | `records` | Legitimate interest / H&S obligation — who was trained to do what is exactly the record a safety incident review needs |
| Session attendance | `session_attendees` | As above |
| No-show/interest data | v2 only — assessed then | — |
| Notification + audit metadata | `notification_log`, `audit_log` | Legitimate interest (operations) |

Data minimisation: nothing beyond id/email/name about a person; no free-text fields *about* people except `revoke_reason` and session `notes` — both flagged to authors as visible-on-review, both in the anonymisation scrub list.

## Erasure — the estate hooks

This app implements the auth service's hook contract ([api-reference.md](api-reference.md#inbound-gdpr-hooks-called-by-the-auth-service)). Anonymisation rewrites the mirror row (`deleted-<id>@anonymised.invalid`, "Deleted user") and scrubs `revoke_reason` / session `notes` mentions where flagged; **records and attendance survive as anonymous rows** — training and safety statistics outlive the person, the same stance as bookings (stage-door ADR-0008). Idempotent; audit-logged.

One training-specific wrinkle: an anonymised *trainer* leaves sessions attributed to "Deleted user". Acceptable — the records those sessions produced remain valid; the evidence chain notes an anonymised trainer, which is true.

## Access

The `export` hook returns this app's contribution to a subject-access bundle: mirror row, all records (current and historical, with sources and dates), sessions attended and delivered. Assembled and delivered by the auth service's flow.

## Retention

- **Records**: kept while the account exists; anonymised (not deleted) when the auth service's erasure or inactivity sweep reaches the person. The sweep's `last-activity` hook answer from this app (latest record/session) correctly keeps active members out of the sweep.
- **Sessions/attendance**: same lifecycle as records.
- **`notification_log`**: pruned after 24 months (operational only).
- **Backups**: weekly/monthly cycle means erased data persists in encrypted backups up to 12 months — same documented ceiling as the rest of the estate.

Proposed periods ride the committee policy ratification; values live in config/docs, not code.
