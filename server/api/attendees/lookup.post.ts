/**
 * POST /api/attendees/lookup: resolve an email to a canonical user id,
 * creating a shadow account through the auth service if needed.
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
      // No email: audit_log is not scrubbed on erasure, and the detail is
      // searchable, so it would re-identify an anonymised row.
      target: attendee.id,
    })
  }

  return attendee
})
