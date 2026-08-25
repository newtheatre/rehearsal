/**
 * Addressing and sending the session emails. Transactional, so these ignore
 * notifications_mode, which gates the sweeps (docs/scheduling-design.md §8.1).
 */

import { db, schema } from '@nuxthub/db'
import { eq, inArray, isNull, and } from 'drizzle-orm'
import { renderRequestAnswered, sendEmail, type SessionEmailSummary } from './email'
import { chunk } from './d1'

export interface Recipient {
  id: string
  name: string
  email: string
}

/** The module names and timing every session email prints. */
export async function sessionEmailSummary(sessionId: string): Promise<SessionEmailSummary | null> {
  const session = await db.select().from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId)).get()
  if (!session) return null

  const modules = await db.select({ name: schema.modules.name, id: schema.modules.id })
    .from(schema.sessionModules)
    .innerJoin(schema.modules, eq(schema.sessionModules.moduleId, schema.modules.id))
    .where(eq(schema.sessionModules.sessionId, sessionId))
    .all()

  return {
    id: session.id,
    heldOn: session.heldOn,
    startsAt: session.startsAt,
    location: session.location,
    moduleNames: modules.map(row => `${row.id} ${row.name}`),
  }
}

/** Addressable people only: an erased or merged account has no real address. */
export async function addressableUsers(userIds: string[]): Promise<Recipient[]> {
  if (userIds.length === 0) return []

  const found: Recipient[] = []
  for (const batch of chunk(userIds)) {
    const rows = await db.select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
    })
      .from(schema.users)
      .where(and(
        inArray(schema.users.id, batch),
        isNull(schema.users.anonymisedAt),
        isNull(schema.users.mergedInto),
      ))
      .all()
    found.push(...rows)
  }
  return found
}

/**
 * Tell whoever asked for a module that it is now scheduled. The design says
 * requesters are told, and a request nobody hears back about is a dead end.
 */
export async function tellRequesters(sessionId: string, userIds: string[]): Promise<number> {
  if (userIds.length === 0) return 0

  const summary = await sessionEmailSummary(sessionId)
  if (!summary) return 0

  const recipients = await addressableUsers(userIds)
  const { sent } = await sendEach(recipients, recipient => renderRequestAnswered({
    name: recipient.name,
    session: summary,
  }))
  return sent
}

/**
 * One failed address must not stop the rest: a cancellation half-sent is
 * worse than one that reports what it could not deliver.
 */
export async function sendEach(
  recipients: Recipient[],
  render: (recipient: Recipient) => { subject: string, html: string },
): Promise<{ sent: number, failed: string[] }> {
  const results = await Promise.allSettled(recipients.map(async (recipient) => {
    const { subject, html } = render(recipient)
    await sendEmail({ to: recipient.email, subject, html })
    return recipient.id
  }))

  const failed = recipients
    .filter((_, index) => results[index]?.status === 'rejected')
    .map(recipient => recipient.id)

  if (failed.length > 0) {
    console.error(`[sessions] could not email ${failed.length} recipient(s):`, failed.join(', '))
  }

  return { sent: results.length - failed.length, failed }
}
