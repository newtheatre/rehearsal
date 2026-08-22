/** GET /api/sessions/:id: one session, scheduled or delivered. */

import { getSessionDetail, withinEditWindow } from '../../utils/sessions'
import { signupBlockedReason, splitByCapacity } from '../../utils/scheduling'
import { maySteward } from '../../utils/sessionAuth'
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

  const signups = session.attendees
    .filter(row => row.status === 'SIGNED_UP')
    .map(row => ({ id: row.attendeeId, signedUpAt: row.signedUpAt, userId: row.id }))
  const { confirmed, waitlisted } = splitByCapacity(signups, session.capacity)
  const held = new Set(confirmed.map(row => row.userId))

  const blocked = signupBlockedReason(session)
  const mineIndex = waitlisted.findIndex(item => item.userId === abilities.user.id)

  const canSteward = maySteward(session, abilities)

  return {
    id: session.id,
    status: session.status,
    heldOn: session.heldOn,
    startsAt: session.startsAt?.toISOString() ?? null,
    endsAt: session.endsAt?.toISOString() ?? null,
    signupsCloseAt: session.signupsCloseAt?.toISOString() ?? null,
    capacity: session.capacity,
    location: session.location,
    description: session.description,
    // Working notes are the trainer's, not the room's.
    notes: canSteward ? session.notes : null,
    cancelReason: session.cancelReason,
    registerOpened: session.registerOpenedAt !== null,
    trainerUserId: session.trainerUserId,
    trainerName: session.trainerName,
    modules: session.modules,
    attendees: canSteward
      ? session.attendees.map(attendee => ({
          id: attendee.id,
          name: attendee.name,
          status: attendee.status,
          hasPlace: attendee.status === 'SIGNED_UP' ? held.has(attendee.id) : true,
        }))
      : null,
    signupCount: signups.length,
    placesLeft: session.capacity === null ? null : Math.max(0, session.capacity - signups.length),
    mine: {
      signedUp: signups.some(item => item.userId === abilities.user.id),
      hasPlace: held.has(abilities.user.id),
      waitlistPosition: mineIndex === -1 ? null : mineIndex + 1,
    },
    recordCount: session.recordCount,
    canSignUp: blocked === null && !signups.some(item => item.userId === abilities.user.id),
    signupBlockedReason: blocked,
    canSteward,
    canEdit: (abilities.isAdmin || isOwnSession)
      && session.status === 'DELIVERED'
      && withinEditWindow(session, editWindowDays),
    editWindowDays,
  }
})
