/**
 * GET /api/sessions/:id: one session, with its modules, attendees and record
 * count.
 */

import { getSessionDetail, withinEditWindow } from '../../utils/sessions'
import { useAbilities } from '../../utils/abilities'
import { getConfigNumber } from '../../utils/siteConfig'
import type { SessionDetail } from '../../../shared/types/session'

export default defineEventHandler(async (event): Promise<SessionDetail> => {
  const abilities = await useAbilities(event)
  const id = getRouterParam(event, 'id')

  const session = id ? await getSessionDetail(id) : null
  if (!session) {
    throw createError({ statusCode: 404, statusMessage: 'Session not found' })
  }

  const editWindowDays = await getConfigNumber('session_edit_window_days')
  const isOwnSession = session.trainerUserId === abilities.user.id
    || session.createdBy === abilities.user.id

  return {
    id: session.id,
    heldOn: session.heldOn,
    location: session.location,
    notes: session.notes,
    trainerUserId: session.trainerUserId,
    trainerName: session.trainerName,
    modules: session.modules,
    attendees: session.attendees,
    recordCount: session.recordCount,
    canEdit: (abilities.isAdmin || isOwnSession) && withinEditWindow(session, editWindowDays),
    editWindowDays,
  }
})
