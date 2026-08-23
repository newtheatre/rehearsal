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

  const signedUp = new Set(mine.map(row => row.sessionId))

  return {
    sessions: sessions.map(session => ({ ...session, signedUp: signedUp.has(session.id) })),
    canSchedule: includePlanned,
  }
})
