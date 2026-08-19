/**
 * Multi-row writes are atomic via db.batch(), never db.transaction() which
 * D1 rejects (ADR-0009).
 */

import { db } from '@nuxthub/db'
import type { BatchItem } from 'drizzle-orm/batch'

export type BatchStatement = BatchItem<'sqlite'>

/** No-op on an empty list; db.batch() wants a non-empty tuple. */
export async function runAtomic(statements: BatchStatement[]): Promise<void> {
  if (statements.length === 0) return
  await db.batch(statements as [BatchStatement, ...BatchStatement[]])
}
