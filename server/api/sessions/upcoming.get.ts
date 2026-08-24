/** GET /api/sessions/upcoming: the schedule. Any member may read it. */

import { useAbilities } from '../../utils/abilities'
import { listUpcoming, myUpcoming } from '../../utils/scheduling'

export default defineEventHandler(async (event) => {
  const abilities = await useAbilities(event)

  // A PLANNED session is not an advertisement: only the people who could open
  // it see one (docs/scheduling-design.md §5.1).
  const includePlanned = abilities.isTrainer || abilities.leadOf.length > 0

  const [sessions, mine] = await Promise.all([
    listUpcoming({ includePlanned }),
    myUpcoming(abilities.user.id),
  ])

  const places = new Map(mine.map(row => [row.sessionId, row.hasPlace]))

  return {
    sessions: sessions.map(session => ({
      ...session,
      signedUp: places.has(session.id),
      // False when they are on the waitlist, so the badge can say which.
      hasPlace: places.get(session.id) ?? false,
    })),
    canSchedule: includePlanned,
  }
})
