import { runExpirySweep } from '../utils/expirySweep'

/**
 * The daily expiry sweep, 06:00 UTC. Dry-run by default —
 * `site_config.notifications_mode` is the switch. docs/operations.md
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
