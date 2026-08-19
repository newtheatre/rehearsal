/**
 * Append-only audit trail. If you are adding a mutation and its peers call
 * this, yours must too (CLAUDE.md invariant 9).
 */

import { db, schema } from '@nuxthub/db'

export interface AuditEntry {
  actorUserId?: string | null // null = cron / import / system
  action: string // 'module.create', 'module.update', 'lead.add', …
  target: string // the id acted upon
  detail?: unknown // JSON-serialisable
}

/** The insert as a statement, for callers batching it with the mutation. */
export function auditStatement(entry: AuditEntry) {
  return db.insert(schema.auditLog).values({
    actorUserId: entry.actorUserId ?? null,
    action: entry.action,
    target: entry.target,
    detail: entry.detail === undefined ? null : JSON.stringify(entry.detail),
  })
}

export async function writeAudit(entry: AuditEntry): Promise<void> {
  await auditStatement(entry)
}
