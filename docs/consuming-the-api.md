# Consuming the API (estate integration guide)

You're wiring an estate app to training data. Proscenium's rota (duty-manager eligibility) is the reference consumer; this is the complete checklist.

**Prerequisites:** your app is a Cloudflare Worker in the NNT estate and you can set worker secrets. The API is read-only: if you think you need to *write* training data from another app, you don't; talk to the ITM.

## Step 1: Get a token

Ask the ITM (or [operations.md](operations.md#service-tokens) if that's you): a token named for your app, shown once, stored in the committee password manager and your worker secret (suggested name `TRAINING_API_TOKEN`).

## Step 2: Call it

```ts
const res = await $fetch(
  `https://training.newtheatre.org.uk/api/v1/eligibility/duty-manager?userId=${user.id}`,
  { headers: { Authorization: `Bearer ${process.env.TRAINING_API_TOKEN}` } },
)
if (!res.eligible) {
  // your app's enforcement: your UX, your rules
}
```

User ids are canonical auth ids: the same ids in your session and mirror. No mapping needed.

## Step 3: One seam, not scattered calls

Wrap your usage behind a single function (the rota's `isDMEligible(userId)` is the pattern). The eligibility *definition* can change any time in the training admin UI without a deploy on either side; your seam means your app never encodes *what* the rule requires, only *that* there is one.

## Freshness & failure (read this twice) <a name="freshness"></a>

- Responses are cacheable 5 minutes; treat eligibility as **advisory-fresh, never transactional**. Fine for gating a rota claim; do not build anything that needs to-the-second revocation on it.
- **Fail soft, and decide your direction deliberately.** If the API is unreachable, your app chooses: fail-open with human confirmation (rota: allow the claim but flag it for FOH-manager confirmation) or fail-closed (block until reachable). Write your choice down in *your* docs. Do not retry-hammer; cache the last-known answer with its timestamp.
- 404 on a rule key means the rule was renamed/removed: surface it loudly (that's a configuration break, not a transient).

## The other question: is somebody being taught this right now? <a name="practice"></a>

`GET /api/v1/practice/:key?userId=` answers `{ key, userId, active, expiresAt, sessionId }`.

It exists for consumer apps with a **training mode**: a sandbox somebody may only reach while they
are actually being taught the thing. Proscenium's bar till is the first
([its ADR-0030](https://github.com/newtheatre/proscenium/blob/main/docs/decisions/0030-training-mode-writes-to-its-own-table.md)).

```ts
const res = await $fetch(
  `https://training.newtheatre.org.uk/api/v1/practice/bar-till?userId=${user.id}`,
  { headers: { Authorization: `Bearer ${process.env.TRAINING_API_TOKEN}` } },
)
if (res.active) {
  // your app's sandbox, open until res.expiresAt
}
```

Four things differ from eligibility, and all four matter:

- **`:key` is a practice target, not an eligibility rule.** Separate namespaces, separate tables, on
  purpose ([ADR-0014](decisions/0014-practice-targets-are-data.md)). The `bar` rule *requires* the
  general induction; teaching the general induction must not open the till.
- **The response is `no-store`. Do not cache it.** A window closes the moment a lead marks the
  register, and a cached `true` keeps your sandbox open after the lesson ended. Ask when you open a
  session and when you resume one, not per request; `expiresAt` tells you when to stop asking.
- **Fail closed.** This is the opposite of the direction the rota chose for eligibility, and
  deliberately: if we are unreachable, nobody gets a sandbox and they shadow a real shift as they did
  before. Nothing about tonight gets worse. Failing open would hand a sandbox to whoever asked at the
  exact moment nobody could check.
- **A 404 means the target was renamed or retired.** Surface it loudly. Never read it as "not
  practising".

Which modules open which target is committee-editable data in our admin UI, so your app hardcodes the
key and never a module id. A catalogue renumbering is then our edit and not your deploy.

## Consumers (current)

| Consumer | Uses | Seam | Status |
|---|---|---|---|
| Proscenium (rota) | `GET /eligibility/duty-manager?userId=` (+ list form for UI badges) | `isEligible()` per its [ADR-0026](https://github.com/newtheatre/proscenium/blob/main/docs/decisions/0026-eligibility-is-read-from-rehearsal-behind-one-seam.md) | **not yet integrated**: the rota isn't built. A token can be issued the day it is. |
| Proscenium (training mode) | `GET /practice/:key?userId=` for `bar-till`, `challenge-25`, `door-scan` | `practiceWindow()` in the same seam file, failing closed and never cached | **Built, awaiting configuration.** Create the three targets here and issue it a token; until then it fails closed and nobody sees a sandbox, which is harmless. Its [ADR-0031](https://github.com/newtheatre/proscenium/blob/main/docs/decisions/0031-the-practice-window-fails-closed.md) records the failure direction. |
| stage-door (conditional role grants) | `GET /eligibility/:key` (list form), once a day | Its `eligibility:snapshot` task | **Live.** A role grant there can be conditional on one of our rules; an unmet answer makes it inert estate-wide (its ADR-0019, our [ADR-0010](decisions/0010-auth-service-holds-a-snapshot.md)). |

Update this table when you integrate, and tell the ITM so rule changes reach you.

## Checklist

- [ ] Token in worker secret + password manager; never in code or CI plaintext
- [ ] All calls behind one seam function
- [ ] Failure direction chosen, documented in your repo, and tested (kill the URL locally)
- [ ] No emails expected from the API (you won't get them)
- [ ] Consumer table above updated
- [ ] If you use practice windows: nothing caches the answer, and you fail closed
