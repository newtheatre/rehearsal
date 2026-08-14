import { runExpirySweep } from '../utils/expirySweep'

/**
 * The daily expiry sweep (docs/operations.md#notifications).
 *
 * Runs at 06:00 UTC. Warns members whose training is entering the warning
 * window or falling inside the final fortnight, and on the 1st sends the
 * monthly digest to department leads and admins.
 *
 * Ships in dry-run mode: `site_config.notifications_mode` decides, and the
 * runbook says to put it back to dry-run after any change to expiry config
 * or the warning window.
 *
 * This task cannot change a record. It reads state, sends email, and writes
 * `notification_log` — nothing else (CLAUDE.md invariant 10).
 */
export default defineTask({
  meta: {
    // Must match the file path — that is what Nitro registers it as.
    name: 'expiry-sweep',
    description: 'Warn members about expiring training; monthly digest to leads and admins',
  },
  async run() {
    const result = await runExpirySweep()

    return {
      result: {
        asOf: result.asOf,
        mode: result.mode,
        sent: result.sent,
        failed: result.failed.length,
        ...result.plan.counts,
      },
    }
  },
})
