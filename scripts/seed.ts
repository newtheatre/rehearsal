/**
 * Dev-only seed: the catalogue plus users covering every ability. There are
 * no credentials to print — sign in through /dev-login.
 */

import { join } from 'node:path'
import { and, eq } from 'drizzle-orm'
import { seedCatalogue } from './seed-catalogue'
import { openLocalDb, schema } from './lib/localDb'
import { computeExpiresAt } from '../server/utils/expiry'
import { CONFIG_DEFAULTS } from '../shared/utils/configDefaults'
import { today } from '../server/utils/validity'

const db = openLocalDb()

// ── Catalogue ───────────────────────────────────────────────────────────────

const csvPath = join(import.meta.dirname, '../data/catalogue.csv')
const { modules } = await seedCatalogue(csvPath, db)
console.info(`Seeded ${modules.length} modules from ${csvPath}`)

// Activate a slice of the catalogue so an ordinary member sees something.
// The real status comes from the subcommittee's CSV.
const ACTIVATE_FOR_DEV = ['NNT-001', 'NNT-002', 'NNT-003', 'SFTY-002', 'SFTY-021', 'TECH-111', 'TECH-112', 'TECH-211', 'ADMN-101', 'ADMN-103', 'LEAD-301', 'LEAD-CERT']
for (const id of ACTIVATE_FOR_DEV) {
  await db.update(schema.modules).set({ status: 'ACTIVE' }).where(eq(schema.modules.id, id))
}
console.info(`Activated ${ACTIVATE_FOR_DEV.length} modules for dev; the rest stay DRAFT (admin/lead-visible only)`)

// ── Config defaults ─────────────────────────────────────────────────────────

for (const [key, value] of Object.entries(CONFIG_DEFAULTS)) {
  await db.insert(schema.siteConfig).values({ key, value }).onConflictDoNothing()
}

// ── Users ───────────────────────────────────────────────────────────────────

// Ids match /dev-login's, so seeding and dev sign-in agree. In production
// these ids only ever come from the auth service (CLAUDE.md invariant 7).
const seedUsers = [
  { id: 'dev-member', email: 'dev-member@dev.newtheatre.org.uk', name: 'Dev Member' },
  { id: 'dev-trainer', email: 'dev-trainer@dev.newtheatre.org.uk', name: 'Dev Trainer' },
  { id: 'dev-lead-tech', email: 'dev-lead-tech@dev.newtheatre.org.uk', name: 'Dev Lead (TECH)' },
  { id: 'dev-admin', email: 'dev-admin@dev.newtheatre.org.uk', name: 'Dev Admin' },
]

for (const user of seedUsers) {
  await db.insert(schema.users).values(user)
    .onConflictDoUpdate({ target: schema.users.id, set: { email: user.email, name: user.name } })
}

await db.insert(schema.departmentLeads)
  .values({ department: 'TECH', userId: 'dev-lead-tech', grantedBy: 'dev-admin' })
  .onConflictDoNothing()

// The trainer's standing is a RECORD, not a flag — that is the whole point
// of ADR-0004, and seeding it any other way would misrepresent the system.
const trainerCert = await db.select().from(schema.modules)
  .where(eq(schema.modules.grantsTrainer, true)).get()

if (trainerCert) {
  const existing = await db.select().from(schema.records)
    .where(and(
      eq(schema.records.userId, 'dev-trainer'),
      eq(schema.records.moduleId, trainerCert.id),
    )).get()

  if (!existing) {
    const awardedAt = today()
    await db.insert(schema.records).values({
      userId: 'dev-trainer',
      moduleId: trainerCert.id,
      awardedAt,
      expiresAt: computeExpiresAt(trainerCert, awardedAt),
      source: 'SIGNOFF',
      grantedBy: 'dev-admin',
    })
    console.info(`Granted ${trainerCert.id} to dev-trainer (source SIGNOFF — the documented bootstrap path)`)
  }
}

console.info(`
Seeded ${seedUsers.length} dev users. No passwords exist — sign in with:

  /dev-login              Dev Member    (ordinary member)
  /dev-login?trainer=1    Dev Trainer   (valid ${trainerCert?.id ?? 'trainer cert'})
  /dev-login?lead=TECH    Dev Lead      (TECH department lead)
  /dev-login?admin=1      Dev Admin     (training:ADMIN)
`)
