/**
 * DEV ONLY — the single sanctioned exception to "apps never write the
 * session" (CLAUDE.md invariant 1; stage-door docs/development.md).
 *
 * Local development without the auth service running: GET /dev-login seals a
 * session for a fake user. Guarded by import.meta.dev — this route does not
 * exist in production builds.
 *
 *   /dev-login                ordinary member
 *   /dev-login?admin=1        training:ADMIN
 *   /dev-login?lead=TECH      department lead for TECH
 *   /dev-login?trainer=1      holds a valid LEAD-CERT record
 *
 * The lead and trainer flavours write real rows, because both abilities are
 * app data by design — there is no way to fake them from the session, which
 * is exactly the property ADR-0004 and ADR-0005 were after.
 */

import { db, schema } from '@nuxthub/db'
import { and, eq } from 'drizzle-orm'
import { computeExpiresAt } from '../utils/expiry'
import { today } from '../utils/validity'

export default defineEventHandler(async (event) => {
  if (!import.meta.dev) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }

  const { admin, lead, trainer } = getQuery(event)
  const isAdmin = Boolean(admin)
  const leadDept = typeof lead === 'string' ? lead.toUpperCase() : null

  const suffix = isAdmin ? 'admin' : leadDept ? `lead-${leadDept.toLowerCase()}` : trainer ? 'trainer' : 'member'
  const user = {
    id: `dev-${suffix}`,
    email: `dev-${suffix}@dev.newtheatre.org.uk`,
    name: isAdmin ? 'Dev Admin' : leadDept ? `Dev Lead (${leadDept})` : trainer ? 'Dev Trainer' : 'Dev Member',
    verified: true,
    guest: false,
    roles: isAdmin ? ['training:ADMIN'] : [],
  }

  await ensureLocalUser(user)

  if (leadDept) {
    const department = await db.select().from(schema.departments)
      .where(eq(schema.departments.code, leadDept)).get()
    if (!department) {
      throw createError({
        statusCode: 400,
        statusMessage: `Unknown department '${leadDept}' — seed the catalogue first (bun run db:seed)`,
      })
    }
    await db.insert(schema.departmentLeads)
      .values({ department: leadDept, userId: user.id })
      .onConflictDoNothing()
  }

  if (trainer) {
    const trainerCert = await db.select().from(schema.modules)
      .where(eq(schema.modules.grantsTrainer, true)).get()
    if (!trainerCert) {
      throw createError({
        statusCode: 400,
        statusMessage: 'No grants_trainer certification in the catalogue — seed it first (bun run db:seed)',
      })
    }
    const existing = await db.select().from(schema.records)
      .where(and(
        eq(schema.records.userId, user.id),
        eq(schema.records.moduleId, trainerCert.id),
      )).get()
    if (!existing) {
      const awardedAt = today()
      await db.insert(schema.records).values({
        userId: user.id,
        moduleId: trainerCert.id,
        awardedAt,
        expiresAt: computeExpiresAt(trainerCert, awardedAt),
        source: 'SIGNOFF',
        grantedBy: user.id,
      })
    }
  }

  const now = Date.now()
  await setUserSession(event, {
    user,
    loggedInAt: now,
    refreshedAt: now,
    epoch: 0,
  })

  return sendRedirect(event, '/', 302)
})
