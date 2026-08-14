/**
 * POST /api/attendees/lookup — resolve an email to a canonical user id,
 * creating a shadow account through the auth service if needed.
 *
 * Trainer-gated: this is a write on the estate's identity store, not a
 * search. See server/utils/shadowUser.ts for why no id is ever minted here.
 */

import { attendeeLookupSchema } from '../../utils/validation'
import { requireTrainer } from '../../utils/auth'
import { findOrCreateAttendee } from '../../utils/shadowUser'
import { writeAudit } from '../../utils/audit'

export default defineEventHandler(async (event) => {
  const abilities = await requireTrainer(event)
  const input = await readValidatedBody(event, attendeeLookupSchema.parse)

  const attendee = await findOrCreateAttendee(event, input)

  if (attendee.created) {
    await writeAudit({
      actorUserId: abilities.user.id,
      action: 'attendee.shadow-created',
      target: attendee.id,
      detail: { email: input.email },
    })
  }

  return attendee
})
