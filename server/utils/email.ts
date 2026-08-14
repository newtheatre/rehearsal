/**
 * Outgoing email: expiry warnings to members, monthly digests to leads and
 * admins.
 *
 * Dev mode (no `NUXT_RESEND_API_KEY`): emails are logged to the console
 * instead of sent — docs/development.md.
 *
 * The copy matters more than it looks. These emails tell someone their
 * training is lapsing, which for a student society is a nudge, not a
 * disciplinary notice — so they say what expired, when, and what to do, and
 * they never imply the person has done something wrong.
 */

import { getResend } from './resend'
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

function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-')
  return `${day}/${month}/${year}`
}

function recordList(records: SweepRecord[]): string {
  return `
    <ul style="padding-left: 18px;">
      ${records.map(record => `
        <li style="margin-bottom: 6px;">
          <strong>${record.moduleId}</strong> ${record.moduleName}
          — ${formatDate(record.expiresAt)}
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
      <p>Hello ${warning.name.split(' ')[0]},</p>
      <p>
        ${soon
          ? `This is a reminder that ${noun} you hold ${count === 1 ? 'expires' : 'expire'} within the next fortnight:`
          : `${noun.charAt(0).toUpperCase()}${noun.slice(1)} you hold will expire before long:`}
      </p>
      ${recordList(warning.records)}
      <p>
        Expired training doesn't disappear from your record — it just stops counting
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
    subject: `NNT training digest — ${digest.expiring.length} expiring, ${digest.expired.length} expired`,
    html: layout(`
      <p>Hello ${digest.name.split(' ')[0]},</p>
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

/** The dry-run report the ITM gets instead of anything reaching members. */
export function renderDryRunReport(summary: {
  asOf: string
  counts: Record<string, number>
  warnings: MemberWarning[]
  digests: Digest[]
}): { subject: string, html: string } {
  return {
    subject: `[dry run] NNT training sweep — ${summary.warnings.length} warnings, ${summary.digests.length} digests withheld`,
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
               <li><strong>${w.name}</strong> (${w.type}) — ${w.records.map(r => r.moduleId).join(', ')}</li>
             `).join('')}
           </ul>`
        : '<p>No member warnings due.</p>'}

      ${summary.digests.length
        ? `<h3 style="font-size: 15px;">Digests (${summary.digests.length})</h3>
           <ul style="padding-left: 18px;">
             ${summary.digests.map(d => `
               <li><strong>${d.name}</strong> — ${d.departments === null ? 'all departments' : d.departments.join(', ')}:
                 ${d.expiring.length} expiring, ${d.expired.length} expired</li>
             `).join('')}
           </ul>`
        : ''}

      <p>Flip to live in <code>/admin</code> → Notifications once this looks right.
      Nothing here has been recorded as sent, so the first live run will still deliver it.</p>
    `),
  }
}
