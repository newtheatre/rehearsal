/**
 * Paging on the list endpoints: the delivery log is the who-trained-whom
 * evidence trail, so nothing may become unreachable by growing past a page.
 */

import { describe, it, expect } from 'bun:test'
import sessionsHandler from '../server/api/sessions/index.get'
import peopleHandler from '../server/api/people/index.get'
import directoryHandler from '../server/api/directory.get'
import createSessionHandler from '../server/api/sessions/index.post'
import { makeEvent, signIn, type FakeEvent } from './setup'
import { seedDepartments, seedModule, seedRecord, seedUser } from './helpers/fixtures'
import { today } from '../shared/utils/dates'

type Handler = (event: FakeEvent) => Promise<unknown>
const call = (handler: unknown, event: FakeEvent) => (handler as Handler)(event)

interface SessionsPage { sessions: { id: string, heldOn: string }[], hasMore: boolean }
interface PeoplePage { people: { id: string, name: string }[], hasMore: boolean }

async function setup() {
  await seedDepartments()
  await seedModule('NNT-001', { name: 'Induction' })
  await seedModule('LEAD-CERT', {
    department: 'LEAD',
    kind: 'CERTIFICATION',
    signoffRequired: true,
    grantsTrainer: true,
  })
  await seedUser('trainer', 'A Trainer')
  await seedRecord({ userId: 'trainer', moduleId: 'LEAD-CERT', expiresAt: null })
}

function memberEvent(path: string, query: Record<string, unknown> = {}) {
  const event = makeEvent({ path, query })
  signIn(event, { id: 'trainer' })
  return event
}

describe('GET /api/sessions', () => {
  async function logSessions(count: number) {
    for (let i = 0; i < count; i++) {
      const event = makeEvent({
        method: 'POST',
        path: '/api/sessions',
        body: { heldOn: today(), moduleIds: ['NNT-001'], attendeeIds: ['trainer'] },
      })
      signIn(event, { id: 'trainer' })
      await call(createSessionHandler, event)
    }
  }

  it('reaches every session through the cursor, with none dropped or repeated', async () => {
    await setup()
    await logSessions(7)

    const seen: string[] = []
    let page = await call(sessionsHandler, memberEvent('/api/sessions', { limit: 3 })) as SessionsPage

    for (let guard = 0; guard < 10; guard++) {
      seen.push(...page.sessions.map(s => s.id))
      if (!page.hasMore) break

      const last = page.sessions.at(-1)!
      page = await call(sessionsHandler, memberEvent('/api/sessions', {
        limit: 3, beforeHeldOn: last.heldOn, beforeId: last.id,
      })) as SessionsPage
    }

    // All seven logged on the same day, so the date alone cannot separate them.
    expect(seen).toHaveLength(7)
    expect(new Set(seen).size).toBe(7)
  })

  it('returns a fixed set of columns, with no trainer working notes among them', async () => {
    await setup()
    const event = makeEvent({
      method: 'POST',
      path: '/api/sessions',
      body: {
        heldOn: today(),
        moduleIds: ['NNT-001'],
        attendeeIds: ['trainer'],
        notes: 'Watch this one on the fly floor',
      },
    })
    signIn(event, { id: 'trainer' })
    await call(createSessionHandler, event)

    const page = await call(sessionsHandler, memberEvent('/api/sessions')) as {
      sessions: Record<string, unknown>[]
    }

    // Any member reads this list, so the columns are allow-listed rather than
    // whatever the table happens to hold.
    expect(Object.keys(page.sessions[0]!).sort()).toEqual([
      'attendeeCount', 'capacity', 'deliveredAt', 'endsAt', 'heldOn', 'id',
      'location', 'moduleIds', 'startsAt', 'status', 'trainerName', 'trainerUserId',
    ])
  })

  it('says when there is more, rather than truncating in silence', async () => {
    await setup()
    await logSessions(3)

    const page = await call(sessionsHandler, memberEvent('/api/sessions', { limit: 2 })) as SessionsPage
    expect(page.sessions).toHaveLength(2)
    expect(page.hasMore).toBe(true)
  })
})

describe('GET /api/people', () => {
  async function seedMembers(count: number) {
    for (let i = 0; i < count; i++) {
      await seedUser(`member-${i}`, `Member ${String(i).padStart(2, '0')}`)
    }
  }

  it('pages the directory and reaches everyone', async () => {
    await setup()
    await seedMembers(6)

    const seen: string[] = []
    let page = await call(peopleHandler, memberEvent('/api/people', { limit: 2 })) as PeoplePage

    for (let guard = 0; guard < 10; guard++) {
      seen.push(...page.people.map(p => p.id))
      if (!page.hasMore) break

      const last = page.people.at(-1)!
      page = await call(peopleHandler, memberEvent('/api/people', {
        limit: 2, afterName: last.name, afterId: last.id,
      })) as PeoplePage
    }

    expect(new Set(seen).size).toBe(7) // six members plus the trainer
  })

  it('searches in SQL, so it finds someone beyond the first page', async () => {
    await setup()
    await seedMembers(6)

    const page = await call(peopleHandler, memberEvent('/api/people', {
      limit: 2, q: 'Member 05',
    })) as PeoplePage

    expect(page.people.map(p => p.name)).toEqual(['Member 05'])
  })
})

describe('GET /api/directory', () => {
  it('returns names for the pickers without the record aggregation', async () => {
    await setup()
    for (let i = 0; i < 60; i++) await seedUser(`member-${i}`, `Member ${String(i).padStart(2, '0')}`)

    const result = await call(directoryHandler, memberEvent('/api/directory')) as PeoplePage

    // A picker must see everyone, not just the directory's first page.
    expect(result.people).toHaveLength(61)
  })
})
