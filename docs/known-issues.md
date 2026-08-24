# Known issues

Bugs that are understood but not fixed. A pull request that fixes one removes its entry.
Severity: **P1** breaks a task outright, **P2** costs someone real time or hides a failure,
**P3** is friction.

## Scheduling and register UI review, 2026-08-24 {#ui-review-2026-08}

Found by loading the real pages in a browser and working through each task as a member, a lead
and an admin, then verifying every claim against the code and the running app. Two defects found
in the same pass were fixed rather than filed: the routing that made the register and amend pages
unreachable, and the practice-target key field that could overwrite a live target.

### A lead cannot answer a request they will not schedule; the only control on the demand board is "Schedule this" {#ui-01}

**P2 · `rehearsal/app/pages/requests.vue:219`**

A lead opens /requests, sees three people waiting for a module the department is not going to run this term, and tries to tell them so. There is nothing to click. The board row offers only "Schedule this". The request stays "Waiting" on the board and on the requester's list indefinitely, and the requester never gets an answer. The other half of this flow is fully built everywhere except the UI: POST /api/module-requests/{id}/decline exists, `declineRequestSchema` validates the reason, the STATUS map on line 46 already has `DECLINED: 'Answered'`, and lines 146-149 render `request.declineReason` to the requester, but nothing in the app can ever set it.

*Should:* The board should carry a decline control (per requester, since the board groups by module) that posts a reason to /api/module-requests/{id}/decline, so the request leaves the board and the requester sees the answer the page is already built to display.

### A refused register shows its only error a full screen above the button {#ui-02}

**P2 · `rehearsal/app/pages/sessions/[id]/register.vue:194`**

On a phone, in the rehearsal room, the lead ticks who is present and taps the big "Mark the register" button at the bottom of the page. When the server refuses (a safety-critical prerequisite gap, or any other error), submit()'s catch sets actionError and blocking, and that is the only feedback: no toast is raised on the error path, unlike the success path at line 130. The alert that carries it is rendered at line 194, above the whole register list (lines 241-267, one p-4 row per person). With a dozen signups the lead's thumb is on the button at the bottom of the page and the error is one or two screens up, off-view. Nothing at the tap point changes: the button stops spinning and the page looks exactly as it did. The warning and all-absent paths do open modals, so only the hard refusal, the one that most needs to be read, is the one that appears to do nothing.

*Should:* A refused submit should raise a toast, or scroll the alert into view, so the person who tapped the button sees who is missing which prerequisite without scrolling to look for it.

### Register tick state is invisible to assistive tech: no aria-pressed, icon is aria-hidden {#ui-03}

**P2 · `rehearsal/app/pages/sessions/[id]/register.vue:242`**

A department lead marks the register on a phone with VoiceOver or TalkBack, tapping each name to say who turned up, then taps "Mark the register". Each row is a <button> whose accessible name is only the person's name. Present/absent is carried entirely by a background tint (line 247) and a swapped UIcon (lines 261-265) which Nuxt UI renders with aria-hidden="true". There is no aria-pressed, no state text, and no accessible name change. The "{{presentCount}} here, {{absentCount}} not" tally at line 278 sits in no live region. Tapping a name therefore announces nothing at all, and re-reading the list gives the same output whether somebody is ticked or not. This is the control that writes permanent training records and sends "sorry we missed you" emails.

*Should:* The button should carry :aria-pressed="Boolean(present[entry.userId])" (or be a real checkbox), and the here/not tally should be role="status" aria-live="polite" so each tap is confirmed.

### "Take the register" and "Amend" silently bounce an admin to the dashboard {#ui-04}

**P2 · `rehearsal/app/pages/sessions/[id]/register.vue:8`**

Sign in as an IT Manager who holds training:ADMIN but has no Trainer certification and leads no department (exactly what /dev-login?admin=1 creates on a clean database), open any scheduled session, and press "Take the register" or "Amend". Both pages carry middleware: 'trainer', which admits only `me.isTrainer || me.leadOf.length > 0` and otherwise does `navigateTo('/')`. The admin lands back on the dashboard with no message at all; a direct URL visit returns a bare 302. The buttons were shown in the first place because the server's `maySteward()` counts `abilities.isAdmin`, so the session page renders the whole steward action row for them, and two of its four controls are dead while "Open for sign-ups" and "Cancel this session" work.

*Should:* The route guard must agree with what the API grants: either admit admins (the same endpoint sets `canEdit` from `abilities.isAdmin`, so an admin is explicitly meant to correct sessions), or hide the buttons for anyone the guard will refuse. A refusal must say why rather than dumping the user on the home page.

### The register's modal buttons fail invisibly: the error renders behind the overlay {#ui-05}

**P2 · `rehearsal/app/pages/sessions/[id]/register.vue:98`**

During a register, tap "Add someone", enter an email for a walk-in, and tap Add when the request fails (an address the lookup rejects, or any server error). `actionError` is set, but the only alert that renders it is at line 194 on the page, behind the modal's overlay, and the modal stays open because `addOpen` is cleared only on success. The Add button spins, stops, and nothing else changes, so the control looks dead. The same applies to "Nobody came": the generic catch closes `confirmOpen` (line 162) but never `allAbsentOpen`, so that button also fails with its message hidden behind the modal.

*Should:* Render the failure inside the modal, exactly as this repo already does for the cancel dialog on the session page, which carries the comment "Rendered inside the modal: the page-level alert sits behind the overlay".

### No loading indicator anywhere in rehearsal, so every navigation into a page that fetches server-side is a dead click {#ui-06}

**P3 · `rehearsal/app/app.vue:2`**

Anyone clicks a nav link or an action button in rehearsal: Sessions, Requests, a session row, Admin > Practice targets. Nothing changes on screen until the target page's data arrives. Every one of these pages `await`s a fetch in setup (sessions/index.vue:6 and :16, [id].vue:9, register.vue:14, edit.vue:14 and :22, requests.vue:8-9, practice-targets.vue:11-13), and Vue Router will not paint the new route until that promise resolves. rehearsal/app/app.vue wraps everything in `<UApp>` but has no `<NuxtLoadingIndicator />`, and grep finds no loading indicator anywhere in the app or nuxt.config. Proscenium's own app.vue carries this exact component with the comment "Without a progress bar that reads as a dead click" (proscenium/app/app.vue:5-9). Local latency hides it (~35ms), but on a phone on theatre wifi this compounds the register bug above into the same reported symptom.

*Should:* Add `<NuxtLoadingIndicator />` inside `<UApp>` in rehearsal/app/app.vue, matching proscenium.

### One shared busy flag spins every action button on the page at once {#ui-07}

**P3 · `rehearsal/app/composables/useAction.ts:9`**

On /requests, a member with several outstanding requests clicks "Withdraw" on one of them. On /sessions/[id], a member clicks "Sign up". `busy` is a single ref returned to the whole page, and every button binds `:loading="busy"`. Withdrawing one request puts a spinner on every other request's Withdraw button and on the "Ask" button simultaneously, so the user cannot tell which row is actually in flight and, because Nuxt UI's `loading` also disables, cannot act on any other row. On the session page, clicking "Sign up" spins "Withdraw" and "Open for sign-ups" at the same time. Related: `[id].vue`'s `cancel()` borrows the same `busy` but only clears `cancelError`, so a stale red `actionError` from an earlier failed sign-up stays on the page even after a cancellation succeeds and toasts.

*Should:* Key the busy state per action (or per row id) so only the control that was clicked shows a spinner, and clear `actionError` whenever any action on the page is retried, not just the ones that go through `act()`.

### Admin home greets the user with a raw internal role identifier, "You hold training:ADMIN." {#ui-08}

**P3 · `rehearsal/app/pages/admin/index.vue:71`**

An admin (typically the incoming IT Manager, who the estate CLAUDE.md says will pick this up cold) opens /admin. The subtitle under the "Admin" heading reads "You hold training:ADMIN." Verified live at http://localhost:3003/admin. `training:ADMIN` is a namespaced session-role constant from the stage-door session contract; it is a database value, not English, and nothing on the page explains it. The non-admin branch of the same ternary is written properly ("You lead TECH."), which shows the intent.

*Should:* Say what the authority is in words, e.g. "You are a training administrator." or "You can change anything here." Internal role identifiers belong in docs/permissions.md, not in a page heading.

### "Schedule this" on a demand row opens a blank form with nothing scheduled and the request untouched {#ui-09}

**P3 · `rehearsal/app/pages/requests.vue:220`**

A department lead reads the demand board, sees "TECH-111, 4 waiting", and taps "Schedule this" on that row. They land on /sessions/schedule with an empty form: no module selected, no indication which request they came from. schedule.vue reads no query parameters at all (its `form` is initialised to empty at :13). They must find the module again in the catalogue picker, and because nothing ties the new session back to the request, the requests stay OPEN on the board and the requesters are never told a session exists. The label promises "this" and delivers a generic Schedule page.

*Should:* Link to `{ path: '/sessions/schedule', query: { moduleId: row.moduleId } }` and have schedule.vue seed `form.moduleIds` from it, so the module is preselected and the resulting session can resolve the open requests (which the detail page already expects, given the `resolvedSessionId`/'SCHEDULED' branch at requests.vue:135).
