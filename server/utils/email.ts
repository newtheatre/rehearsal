/**
 * Every email this app sends. Copy is a nudge, not a disciplinary notice:
 * never imply the person has done something wrong.
 */

import { getResend } from './resend'
import { formatDate, formatDateTime } from '../../shared/utils/dates'
import type { Digest, MemberWarning, SweepRecord } from './expiryPlan'

interface SendEmailOptions {
  to: string
  subject: string
  html: string
}

export async function sendEmail({ to, subject, html }: SendEmailOptions): Promise<void> {
  const resend = getResend()
  if (!resend) {
    console.info(`[Email:dev] To: ${to}\n[Email:dev] Subject: ${subject}\n[Email:dev] ${html}`)
    return
  }

  const from = useRuntimeConfig().resendFromEmail || 'training@newtheatre.org.uk'
  const { error } = await resend.emails.send({ from, to, subject, html })

  if (error) {
    // Thrown, not swallowed: the sweep counts failures and reports them, and
    // a silently dropped warning is indistinguishable from one nobody needed.
    console.error('[Email] Failed to send:', error)
    throw new Error(`Failed to send email to ${to}`)
  }
}

/**
 * Everything interpolated into an email body goes through this: names, module
 * names and a lead's free text are all user input.
 */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function layout(body: string): string {
  return `
    <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
      <p style="font-weight: 700; font-size: 18px;">The Nottingham New Theatre</p>
      ${body}
      <p style="margin-top: 32px; font-size: 13px; color: #666;">
        Training records live at
        <a href="https://training.newtheatre.org.uk" style="color: #8b2f8b;">training.newtheatre.org.uk</a>.
      </p>
    </div>
  `
}

function recordList(records: SweepRecord[]): string {
  return `
    <ul style="padding-left: 18px;">
      ${records.map(record => `
        <li style="margin-bottom: 6px;">
          <strong>${esc(record.moduleId)}</strong> ${esc(record.moduleName)}
         : ${formatDate(record.expiresAt)}
        </li>
      `).join('')}
    </ul>
  `
}

export function renderMemberWarning(warning: MemberWarning): { subject: string, html: string } {
  const soon = warning.type === 'expiry.14day'
  const count = warning.records.length
  const noun = count === 1 ? 'a training module' : `${count} training modules`

  return {
    subject: soon
      ? `Your NNT training expires soon`
      : `A heads-up about your NNT training`,
    html: layout(`
      <p>Hello ${esc(warning.name.split(' ')[0] ?? '')},</p>
      <p>
        ${soon
          ? `This is a reminder that ${noun} you hold ${count === 1 ? 'expires' : 'expire'} within the next fortnight:`
          : `${noun.charAt(0).toUpperCase()}${noun.slice(1)} you hold will expire before long:`}
      </p>
      ${recordList(warning.records)}
      <p>
        Expired training doesn't disappear from your record: it just stops counting
        towards things that need it, like supervising a get-in or duty-managing a show.
        Ask your department head about getting re-trained.
      </p>
    `),
  }
}

export function renderDigest(digest: Digest, asOf: string): { subject: string, html: string } {
  const scope = digest.departments === null
    ? 'across the theatre'
    : `in ${digest.departments.join(', ')}`

  const nothing = digest.expiring.length === 0 && digest.expired.length === 0

  return {
    subject: `NNT training digest: ${digest.expiring.length} expiring, ${digest.expired.length} expired`,
    html: layout(`
      <p>Hello ${esc(digest.name.split(' ')[0] ?? '')},</p>
      <p>Monthly training summary ${scope}, as of ${formatDate(asOf)}.</p>

      ${nothing
        ? `<p>Nothing is expiring or expired. This email still arrives every month so that
             its absence means something is wrong with the cron, not that there was
             nothing to say.</p>`
        : ''}

      ${digest.expiring.length
        ? `<h3 style="font-size: 15px;">Expiring soon (${digest.expiring.length})</h3>
           ${recordList(digest.expiring)}`
        : ''}

      ${digest.expired.length
        ? `<h3 style="font-size: 15px;">Already expired (${digest.expired.length})</h3>
           ${recordList(digest.expired)}`
        : ''}

      ${!nothing ? '<p>Worth scheduling a session if these are piling up.</p>' : ''}
    `),
  }
}

// ── Sessions ────────────────────────────────────────────────────────────────

export interface SessionEmailSummary {
  id: string
  heldOn: string
  startsAt: Date | null
  location: string | null
  moduleNames: string[]
}

function firstName(name: string): string {
  return name.split(' ')[0] ?? name
}

function sessionCard(session: SessionEmailSummary): string {
  const when = session.startsAt
    ? formatDateTime(session.startsAt)
    : formatDate(session.heldOn)

  return `
    <div style="border-left: 3px solid #8b2f8b; padding-left: 12px; margin: 16px 0;">
      <p style="margin: 0; font-weight: 600;">${esc(session.moduleNames.join(', '))}</p>
      <p style="margin: 4px 0 0; color: #444;">${when}</p>
      ${session.location ? `<p style="margin: 4px 0 0; color: #444;">${esc(session.location)}</p>` : ''}
    </div>
  `
}

export function renderSignupConfirmation(options: {
  name: string
  session: SessionEmailSummary
  hasPlace: boolean
  waitlistPosition: number | null
}): { subject: string, html: string } {
  const { session, hasPlace, waitlistPosition } = options

  return {
    subject: hasPlace
      ? `You're signed up: ${session.moduleNames.join(', ')}`
      : `You're on the waitlist: ${session.moduleNames.join(', ')}`,
    html: layout(`
      <p>Hello ${esc(firstName(options.name))},</p>
      <p>${hasPlace
        ? 'You have a place at this training session.'
        : `This session is full, so you are number ${waitlistPosition} on the waitlist.`}</p>
      ${sessionCard(session)}
      <p>${hasPlace
        ? 'If you can no longer make it, please withdraw so somebody on the waitlist can take the place.'
        : 'If somebody withdraws we will email you straight away. It is worth turning up either way if you can: places often come free on the day.'}</p>
    `),
  }
}

export function renderWaitlistPromotion(options: {
  name: string
  session: SessionEmailSummary
}): { subject: string, html: string } {
  return {
    subject: `A place has come free: ${options.session.moduleNames.join(', ')}`,
    html: layout(`
      <p>Hello ${esc(firstName(options.name))},</p>
      <p>Somebody has withdrawn, so you now have a place at this session.</p>
      ${sessionCard(options.session)}
      <p>Nothing to do: you are on the list. If you cannot make it after all, please withdraw so the
      place passes on.</p>
    `),
  }
}

export function renderRequestAnswered(options: {
  name: string
  session: SessionEmailSummary
}): { subject: string, html: string } {
  return {
    subject: `Now scheduled: ${options.session.moduleNames.join(', ')}`,
    html: layout(`
      <p>Hello ${esc(firstName(options.name))},</p>
      <p>You asked to be taught this, and it is now in the diary.</p>
      ${sessionCard(options.session)}
      <p>Asking put it there, so thank you for saying. A place is not reserved for
      you: sign up on the schedule and it is yours.</p>
    `),
  }
}

export function renderSessionCancelled(options: {
  name: string
  session: SessionEmailSummary
  reason: string
}): { subject: string, html: string } {
  return {
    subject: `Cancelled: ${options.session.moduleNames.join(', ')}`,
    html: layout(`
      <p>Hello ${esc(firstName(options.name))},</p>
      <p>This session has been cancelled, so there is nothing to turn up to.</p>
      ${sessionCard(options.session)}
      <p><strong>Reason given:</strong> ${esc(options.reason)}</p>
      <p>Your training record is unchanged. Keep an eye on the schedule for the next one, or ask for
      the module to be taught again and we will know there is demand for it.</p>
    `),
  }
}

/**
 * The note to somebody who signed up and did not come. A nudge, never a
 * telling-off: it says what was not recorded, not that they failed anything.
 */
export function renderMissedYou(options: {
  name: string
  session: SessionEmailSummary
}): { subject: string, html: string } {
  const { session } = options
  const plural = session.moduleNames.length === 1 ? 'it' : 'them'

  return {
    subject: `Sorry we missed you: ${session.moduleNames.join(', ')}`,
    html: layout(`
      <p>Hello ${esc(firstName(options.name))},</p>
      <p>You were signed up for this session and we did not see you there, so there is nothing on
      your training record for it.</p>
      ${sessionCard(session)}
      <p>Nothing has been held against you and nothing has been taken away. It only means
      ${session.moduleNames.length === 1 ? 'this module is' : 'these modules are'} still outstanding,
      so anything that needs ${plural} is still waiting on ${plural}.</p>
      <p>The schedule has the next one, and if there is not a date that suits you, ask for the module
      to be taught again and we will know there is demand for it.</p>
      <p>If you did come and this is wrong, tell whoever ran the session and they can put it right.</p>
    `),
  }
}

/**
 * `session_reminder_days` is operator-tunable, so the copy names the day the
 * session is actually on rather than assuming the reminder is the day before.
 */
export function renderSessionReminder(options: {
  name: string
  session: SessionEmailSummary
  hasPlace: boolean
  daysAhead: number
}): { subject: string, html: string } {
  const date = formatDate(options.session.heldOn)
  const heading = options.daysAhead === 0 ? 'Today' : options.daysAhead === 1 ? 'Tomorrow' : `On ${date}`
  const when = options.daysAhead === 0 ? 'today' : options.daysAhead === 1 ? 'tomorrow' : `on ${date}`

  return {
    subject: `${heading}: ${options.session.moduleNames.join(', ')}`,
    html: layout(`
      <p>Hello ${esc(firstName(options.name))},</p>
      <p>${options.hasPlace
        ? `A reminder that you have a place at this session ${when}.`
        : `A reminder about this session ${when}. You are on the waitlist, so you do not have a place, but people often withdraw on the day and it is worth coming along.`}</p>
      ${sessionCard(options.session)}
      <p>${options.hasPlace
        ? 'If you can no longer make it, please withdraw so somebody on the waitlist can take the place.'
        : ''}</p>
    `),
  }
}

/** The nag to a lead whose session has passed with an unmarked register. */
export function renderRegisterNag(options: {
  name: string
  session: SessionEmailSummary
  signupCount: number
  daysAgo: number
}): { subject: string, html: string } {
  return {
    subject: `Unmarked register: ${options.session.moduleNames.join(', ')}`,
    html: layout(`
      <p>Hello ${esc(firstName(options.name))},</p>
      <p>This session was ${options.daysAgo} day${options.daysAgo === 1 ? '' : 's'} ago and its
      register has not been marked, so <strong>nobody has been given a record for it</strong>.</p>
      ${sessionCard(options.session)}
      <p>${options.signupCount} ${options.signupCount === 1 ? 'person was' : 'people were'} signed up.
      Marking the register is what creates the records, so until you do, as far as the rest of the
      estate is concerned this training did not happen.</p>
      <p>If it did not happen, cancel the session instead and everyone signed up will be told.</p>
    `),
  }
}

/** The dry-run report the ITM gets instead of anything reaching members. */
export function renderDryRunReport(summary: {
  asOf: string
  counts: Record<string, number>
  warnings: MemberWarning[]
  digests: Digest[]
}): { subject: string, html: string } {
  return {
    subject: `[dry run] NNT training sweep: ${summary.warnings.length} warnings, ${summary.digests.length} digests withheld`,
    html: layout(`
      <p><strong>Nothing was sent to anybody.</strong> Notifications are in dry-run mode
      (<code>site_config.notifications_mode</code>); this is what would have gone out on
      ${formatDate(summary.asOf)}.</p>

      <p>
        ${summary.counts.recordsConsidered} records considered ·
        ${summary.counts.expiring} expiring · ${summary.counts.expired} expired ·
        ${summary.counts.unaddressable} unaddressable
      </p>

      ${summary.warnings.length
        ? `<h3 style="font-size: 15px;">Member warnings (${summary.warnings.length})</h3>
           <ul style="padding-left: 18px;">
             ${summary.warnings.map(w => `
               <li><strong>${esc(w.name)}</strong> (${esc(w.type)}): ${esc(w.records.map(r => r.moduleId).join(', '))}</li>
             `).join('')}
           </ul>`
        : '<p>No member warnings due.</p>'}

      ${summary.digests.length
        ? `<h3 style="font-size: 15px;">Digests (${summary.digests.length})</h3>
           <ul style="padding-left: 18px;">
             ${summary.digests.map(d => `
               <li><strong>${esc(d.name)}</strong>, ${d.departments === null ? 'all departments' : esc(d.departments.join(', '))}:
                 ${d.expiring.length} expiring, ${d.expired.length} expired</li>
             `).join('')}
           </ul>`
        : ''}

      <p>Flip to live in <code>/admin</code> → Notifications once this looks right.
      Nothing here has been recorded as sent, so the first live run will still deliver it.</p>
    `),
  }
}
