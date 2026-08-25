/**
 * What a failed statement is allowed to say in the log: the driver's message,
 * and never the values bound into it.
 */

import { describe, it, expect } from 'bun:test'
import { describeDbFailure, dbFailureLine } from '../server/utils/dbError'
import { db, schema } from './mocks/nuxthub-db'
import { HttpError } from './setup'

/** A genuine Drizzle failure: the foreign keys have nothing to point at. */
async function realDbError(): Promise<unknown> {
  return db.insert(schema.departmentLeads)
    .values({ department: 'NOPE', userId: 'ada-lovelace@newtheatre.org.uk' })
    .run()
    .then(() => undefined)
    .catch((error: unknown) => error)
}

describe('describeDbFailure', () => {
  it('reports what the driver said', async () => {
    const failure = describeDbFailure(await realDbError())

    expect(failure).toBeDefined()
    expect(failure!.message).toMatch(/FOREIGN KEY|SQLITE_CONSTRAINT/i)
  })

  it('names the statement, with placeholders in place of the values', async () => {
    const failure = describeDbFailure(await realDbError())

    expect(failure!.sql).toContain('department_leads')
    expect(failure!.sql).not.toContain('ada-lovelace')
  })

  it('never carries a bound value, which is a member name or address', async () => {
    const error = await realDbError()

    // Drizzle's own message is the SQL plus its parameters, so it must not survive.
    expect((error as Error).message).toContain('ada-lovelace')
    expect(JSON.stringify(describeDbFailure(error))).not.toContain('ada-lovelace')
    expect(dbFailureLine('GET /api/people', error)).not.toContain('ada-lovelace')
  })

  it('reads a cause the driver attached below its own message', () => {
    const cause = Object.assign(new Error('Network connection lost.'), { code: 'D1_ERROR' })
    const wrapper = Object.assign(new Error('Failed query: select 1\nparams: '), {
      query: 'select 1',
      cause,
    })

    expect(describeDbFailure(wrapper)).toMatchObject({
      message: 'Network connection lost.',
      code: 'D1_ERROR',
      sql: 'select 1',
    })
  })

  it('says nothing about an error that did not come from the database', () => {
    const notADbError = new HttpError({ statusCode: 422, statusMessage: 'Prerequisites unmet' })

    expect(describeDbFailure(notADbError)).toBeUndefined()
    expect(dbFailureLine('POST /api/people/x/signoff', notADbError))
      .not.toContain('Prerequisites unmet')
  })
})

describe('dbFailureLine', () => {
  it('is one line, so a log search finds every database failure', async () => {
    const line = dbFailureLine('GET /api/me', await realDbError())

    expect(line.startsWith('[db] GET /api/me: ')).toBe(true)
    expect(line.split('\n')).toHaveLength(1)
  })
})
