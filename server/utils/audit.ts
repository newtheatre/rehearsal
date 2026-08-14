/**
 * Append-only audit trail. Every privileged mutation writes here
 * (CLAUDE.md invariant 9) — if you are adding a mutation and its peers call
 * this, yours must too.
 */

import { db, schema } from '@nuxthub/db'

export async function writeAudit(entry: {
  actorUserId?: string | null // null = cron / import / system
  action: string // 'module.create', 'module.update', 'lead.add', …
  target: string // the id acted upon
  detail?: unknown // JSON-serialisable
}): Promise<void> {
  await db.insert(schema.auditLog).values({
    actorUserId: entry.actorUserId ?? null,
    action: entry.action,
    target: entry.target,
    detail: entry.detail === undefined ? null : JSON.stringify(entry.detail),
  })
}
