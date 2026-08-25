/**
 * What the database driver actually said. Drizzle's own wrapper message is the
 * SQL plus every bound value, so only the cause is safe to log (ADR-0016).
 */

/** A D1 statement can run to kilobytes; a log line may not. */
const SQL_LOG_LIMIT = 160

/** How far down a cause chain to look before giving up. */
const MAX_DEPTH = 8

export interface DbFailure {
  /** The driver's own message, or messages, outermost first. */
  message: string
  code?: string
  /** Placeholders only: Drizzle binds every value, so none appear here. */
  sql?: string
}

interface ErrorLike {
  name?: unknown
  message?: unknown
  code?: unknown
  cause?: unknown
  query?: unknown
}

function asErrorLike(value: unknown): ErrorLike | undefined {
  return typeof value === 'object' && value !== null ? value as ErrorLike : undefined
}

function text(value: unknown): string | undefined {
  if (typeof value === 'string' && value) return value
  if (typeof value === 'number') return String(value)
  return undefined
}

/**
 * The driver's account of a failed statement, or nothing when the error did
 * not come from the database at all.
 */
export function describeDbFailure(error: unknown): DbFailure | undefined {
  const messages: string[] = []
  let node = asErrorLike(error)
  let sql: string | undefined
  let code: string | undefined
  let fromDatabase = false

  for (let depth = 0; node && depth < MAX_DEPTH; depth++) {
    const query = text(node.query)
    if (query) {
      fromDatabase = true
      sql ??= query
    }

    const message = text(node.message)
    // Drizzle's wrapper message embeds the bound values: keep the cause's only.
    if (message && !query && !message.startsWith('Failed query:')) {
      // Drivers nest the same sentence twice; the outer one already says it.
      if (!messages.some(seen => seen.includes(message))) messages.push(message)
      if (/\b(D1_|SQLITE_)/.test(message)) fromDatabase = true
    }

    code ??= text(node.code)
    node = asErrorLike(node.cause)
  }

  if (!fromDatabase || !messages.length) return undefined

  return {
    message: messages.slice(0, 3).join('; '),
    code,
    sql: sql && sql.length > SQL_LOG_LIMIT ? `${sql.slice(0, SQL_LOG_LIMIT)}...` : sql,
  }
}

/**
 * One log line naming the statement that failed and what the driver said.
 * Never the bound values: those are a member's name and address.
 */
export function dbFailureLine(where: string, error: unknown): string {
  const failure = describeDbFailure(error)
  if (!failure) {
    const name = text(asErrorLike(error)?.name) ?? 'unknown error'
    return `[db] ${where}: ${name} (not a database failure)`
  }

  const parts = [`[db] ${where}: ${failure.message}`]
  if (failure.code) parts.push(`code=${failure.code}`)
  if (failure.sql) parts.push(`sql=${failure.sql}`)
  return parts.join(' ')
}
