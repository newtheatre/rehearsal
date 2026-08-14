/** GET /api/sessions/:id — one session, with its modules, attendees and record count. */

import { getSessionDetail, withinEditWindow } from '../../utils/sessions'
import { useAbilities } from '../../utils/abilities'
import { getConfigNumber } from '../../utils/siteConfig'

export default defineEventHandler(async (event) => {
  const abilities = await useAbilities(event)
  const id = getRouterParam(event, 'id')

  const session = id ? await getSessionDetail(id) : null
  if (!session) {
    throw createError({ statusCode: 404, statusMessage: 'Session not found' })
  }

  const editWindowDays = await getConfigNumber('session_edit_window_days')
  const isOwnSession = session.trainerUserId === abilities.user.id || session.createdBy === abilities.user.id

  return {
    ...session,
    canEdit: (abilities.isAdmin || isOwnSession) && withinEditWindow(session, editWindowDays),
    editWindowDays,
  }
})
