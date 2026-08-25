# Permissions

Who may do what. Authentication is the auth service's; everything here is app-owned authorisation, evaluated server-side (the UI reflecting it is a courtesy, not the check).


## The three sources of authority

1. **`training:ADMIN`** (auth-service scoped role, the only one this app uses): the **Theatre Manager** (overall training owner) and the **ITM** (operational). Granted in the auth admin UI; privileged surfaces enforce the estate's 15-minute role-staleness refresh per the session contract. That includes every admin fallback, not just the routes named after a permission: signing off a certification outside one's own department, recording an external certificate, and editing a session that is not one's own or is past its window all route through `requirePermission`, so a role revoked in the auth service stops working within the window rather than lasting the life of the cookie.
2. **Department leads** (`department_leads` table): per-department authority, tech → CTD, workshop/set → CWM, stage management → CSM, costume/producing → TBC. Data, not roles ([ADR-0005](decisions/0005-department-leads-as-data.md)): reality varies by department and by year, and handover is a row swap.
3. **Derived trainer standing**: a currently-valid record for a `grants_trainer` certification (LEAD-CERT), checked at request time, never cached ([ADR-0004](decisions/0004-trainer-standing-from-records.md)).

> **Role namespace:** `training` (not `rehearsal`): it matches the domain and the role was named in the plan before the repo was. The auth service learns it from this app's manifest; there is nothing to register by hand.

## The manifest, and what deliberately stays out of it

`shared/utils/appManifest.ts` declares `training:ADMIN` and the four permissions it carries
(`module.manage`, `record.manage`, `signoff.any`, `config.manage`) to the auth service, which polls
`GET /api/_hooks/auth/manifest` (stage-door ADR-0017). It is also the only place the string
`training` appears: `ROLE_NAMESPACE` and the client admin middleware both read it from there.

Server routes name the permission they need through `requirePermission(event, …)`. `training:ADMIN`
carries all four, so nothing changed about who may do what, but the routes now say which question
they are asking: editing site config, service tokens, eligibility rules and department leads is
`config.manage`; revoking a record and the recalculate tooling is `record.manage`; catalogue
writes are `module.manage`; and signing off a certification outside one's own department is
`signoff.any`, which is exactly what "not this department's lead, so needs authority over all of
them" means. `requireDepartmentSteward` takes the permission its caller needs rather than assuming
one, so a future role granted only `signoff.any` does not silently gain catalogue authority.

**The other two sources of authority stay local and are not in the manifest.** Department leadership
is a row in `department_leads`, so a handover is a row swap rather than nine grants. Trainer standing
is derived from holding a current `grants_trainer` certification, so it lapses with the certification
and no admin acts. Neither is a role, and putting either in the manifest would turn a training
outcome into something someone has to remember to revoke.

## Ability matrix

| Ability | Member | Trainer | Dept lead (own dept) | `training:ADMIN` |
|---|---|---|---|---|
| Browse catalogue, people, own dashboard | ✓ | ✓ | ✓ | ✓ |
| See DRAFT modules / admin notes | | | ✓ | ✓ |
| Sign up to a session, or withdraw | ✓ | ✓ | ✓ | ✓ |
| Ask for a module to be taught, or withdraw the ask | ✓ | ✓ | ✓ | ✓ |
| See the demand board, decline a request | | | ✓ | ✓ |
| Open or close a practice window by hand | | ✓ | ✓ | ✓ |
| Edit practice targets | | | | ✓ |
| Log / edit (≤14 d) a session | | ✓ | ✓* | ✓ |
| Schedule, open, amend or cancel a session | | ✓† | ✓ | ✓ |
| Take and mark a register, add a walk-in | | ✓† | ✓ | ✓ |
| Sign off a certification | | | ✓ | ✓ |
| Edit modules (CRUD, status, expiry config, materials, prereqs) | | | ✓ | ✓ |
| Record external certs | | | ✓ | ✓ |
| Revoke records | | | | ✓ |
| Manage leads, rules, tokens, config; imports; recalc; audit log | | | | ✓ |

\* a lead who isn't themselves a trainer logging a session is unusual but permitted: they carry more authority, not less; the session records them as trainer.

† a trainer may schedule freely, but may only open, amend or cancel a session they are running or created. A department lead may steward anyone's.

## Bootstrap

Day one, nobody holds LEAD-CERT. Admins grant the first Trainer certs to the established trainers as `SIGNOFF` records (honest provenance), after which the normal path (LEAD-301 + supervised delivery + sign-off) applies.

## Pages

| Route | Guard |
|---|---|
| `/` `/modules*` `/people*` `/requests` | authenticated |
| `/sessions/new`, `/sessions/schedule`, `/sessions/:id/edit`, session edit | trainer-or-better (derived check) |
| person-page sign-off / external-cert actions | lead (matching dept) or admin |
| `/admin` module & lead sections | lead (scoped to own dept) or admin |
| `/admin/practice-targets` | admin (`config.manage`) |
| `/admin` everything else | admin |
| `/api/v1/*` | service token ([api-reference.md](api-reference.md)) |
| `/api/health` | public |

Global server middleware fails closed: everything requires a session except `/api/health` and the auth redirects. The middleware also runs `ensureLocalUser`.

That upsert is **best effort on a read and required on a write**: if it fails, a `GET`, `HEAD` or `OPTIONS` logs the database error and carries on, while any other method rethrows and the request 500s ([ADR-0016](decisions/0016-the-user-mirror-is-best-effort-on-a-read.md)). No read needs the mirror row to answer; a mutation may write a row that foreign-keys it, and refusing beats half-writing a record.

Two subtrees carry a different credential rather than a session, and each is enforced by its own middleware beside the global one, not by every route remembering: `/api/v1/**` needs a service token (`server/middleware/consumer-api.ts`, which also sets the consumer cache header) and `/api/_hooks/**` needs the auth service's shared secret (`server/middleware/hooks.ts`). A new route under either is therefore guarded the moment it exists.
