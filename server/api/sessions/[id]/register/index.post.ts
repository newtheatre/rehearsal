/** POST /api/sessions/:id/register: mark it, which is what awards records. */

import { MAX_REGISTER, registerSchema } from '../../../../utils/validation'
import { requireTrainer } from '../../../../utils/auth'
import { getConfig, getConfigNumber } from '../../../../utils/siteConfig'
import { loadModules } from '../../../../utils/records'
import { checkSessionPrerequisites, deliverSession } from '../../../../utils/sessions'
import { loadSessionRow, moduleIdsFor, registerFor } from '../../../../utils/scheduling'
import { assertMaySteward } from '../../../../utils/sessionAuth'
import { addressableUsers, sendEach, sessionEmailSummary } from '../../../../utils/sessionNotify'
import { renderMissedYou } from '../../../../utils/email'
import { describeGaps } from '../../../../utils/prerequisites'
import { writeAudit } from '../../../../utils/audit'
import { formatDate, today } from '../../../../../shared/utils/dates'

export default defineEventHandler(async (event) => {
  const abilities = await requireTrainer(event)
  const id = getRouterParam(event, 'id')

  const session = id ? await loadSessionRow(id) : undefined
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Session not found' })

  assertMaySteward(session, abilities)

  // The guard against a double tap, a retry, or a second lead on a second
  // phone awarding the same training twice (ADR-0013).
  if (session.status === 'DELIVERED') {
    throw createError({ statusCode: 409, statusMessage: 'That register has already been marked' })
  }
  if (session.status === 'CANCELLED') {
    throw createError({ statusCode: 409, statusMessage: 'That session was cancelled' })
  }

  // Records are stamped with held_on, and a record dated ahead of today is
  // valid to every gate in the system (validation.ts, awardedAtSchema).
  if (session.heldOn > today()) {
    throw createError({
      statusCode: 409,
      statusMessage: `That session is not until ${formatDate(session.heldOn)}. If it has been taught, move its date to today first, then mark the register.`,
    })
  }

  // Read before the body is parsed, so an over-long register is refused with
  // something a lead can act on rather than a bare validation error.
  const register = await registerFor(session)
  if (register.length > MAX_REGISTER) {
    throw createError({
      statusCode: 409,
      statusMessage: `That register has ${register.length} people on it, more than the ${MAX_REGISTER} that can be marked at once. Split the session.`,
    })
  }

  const input = await readValidatedBody(event, registerSchema.parse)

  // The marks must match the register in both directions. A stale phone must
  // not award somebody who withdrew, nor silently skip somebody it never saw.
  const known = new Set(register.map(entry => entry.userId))
  const strangers = input.marks.filter(mark => !known.has(mark.userId))
  if (strangers.length > 0) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Somebody on your register is no longer signed up. Reload it.',
    })
  }

  const marked = new Set(input.marks.map(mark => mark.userId))
  const unmarked = register.filter(entry => !marked.has(entry.userId))
  if (unmarked.length > 0) {
    throw createError({
      statusCode: 409,
      statusMessage: `${unmarked.map(entry => entry.name).join(', ')} ${unmarked.length === 1 ? 'is' : 'are'} on the register but not marked. Reload it.`,
      data: { unmarked: unmarked.map(entry => entry.userId) },
    })
  }

  const present = input.marks.filter(mark => mark.present).map(mark => mark.userId)

  // One tap on a register where nobody is ticked awards nothing and emails
  // everybody a no-show note, so it is confirmed rather than assumed.
  if (present.length === 0 && !input.acknowledgeAllAbsent) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Nobody is marked as here. Confirm that the session ran with nobody present.',
      data: { requiresAllAbsentAcknowledgement: true },
    })
  }

  const [modules, warningWindowDays, academicYearEnd] = await Promise.all([
    loadModules(await moduleIdsFor(session.id)),
    getConfigNumber('warning_window_days'),
    getConfig('academic_year_end'),
  ])

  // Checked again over the people actually present: somebody can sign up in
  // October and lose a prerequisite to expiry before the session runs.
  const { blocking, warnings } = await checkSessionPrerequisites(
    modules,
    present,
    { warningWindowDays },
  )

  if (blocking.length > 0) {
    throw createError({
      statusCode: 422,
      statusMessage: 'Missing prerequisites for a safety-critical module',
      data: { blocking, warnings },
    })
  }
  if (warnings.length > 0 && !input.acknowledgeWarnings) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Some attendees are missing prerequisites',
      data: { warnings, requiresAcknowledgement: true },
    })
  }

  const result = await deliverSession({
    session,
    modules,
    marks: input.marks,
    actorUserId: abilities.user.id,
    academicYearEnd,
  })

  await writeAudit({
    actorUserId: abilities.user.id,
    action: 'session.deliver',
    target: session.id,
    detail: {
      heldOn: session.heldOn,
      modules: modules.map(module => module.id),
      present: result.present.length,
      absent: result.absent.length,
      recordsCreated: result.recordCount,
      acknowledgedWarnings: warnings.map(warning => ({
        userId: warning.userId,
        moduleId: warning.moduleId,
        missing: describeGaps(warning.missing),
      })),
    },
  })

  // After the batch: the records are the fact, the email is the courtesy.
  const summary = result.absent.length > 0 ? await sessionEmailSummary(session.id) : null
  let told = 0
  if (summary) {
    const recipients = await addressableUsers(result.absent)
    const sent = await sendEach(recipients, recipient => renderMissedYou({
      name: recipient.name,
      session: summary,
    }))
    told = sent.sent
  }

  return {
    id: session.id,
    recordCount: result.recordCount,
    present: result.present.length,
    absent: result.absent.length,
    toldAbsentees: told,
    warnings,
  }
})
