/**
 * Fixture builders. Deliberately explicit: a test that quietly relies on a
 * default expiry policy is a test that stops meaning what it says.
 */

import { db, schema } from '../mocks/nuxthub-db'

export async function seedDepartments(codes = ['NNT', 'TECH', 'STGE', 'LEAD']) {
  for (const [index, code] of codes.entries()) {
    await db.insert(schema.departments).values({ code, name: code, sort: index })
  }
}

export async function seedUser(id: string, name = id) {
  await db.insert(schema.users).values({
    id,
    email: `${id}@dev.newtheatre.org.uk`,
    name,
  })
}

export async function seedModule(id: string, overrides: Partial<typeof schema.modules.$inferInsert> = {}) {
  const department = overrides.department ?? id.split('-')[0]!
  await db.insert(schema.modules).values({
    id,
    department,
    name: overrides.name ?? id,
    status: 'ACTIVE',
    ...overrides,
  })
}

export async function seedLead(department: string, userId: string) {
  await db.insert(schema.departmentLeads).values({ department, userId })
}

export async function seedRecord(overrides: Partial<typeof schema.records.$inferInsert> & {
  userId: string
  moduleId: string
}) {
  await db.insert(schema.records).values({
    awardedAt: '2026-01-01',
    source: 'SIGNOFF',
    ...overrides,
  })
}
