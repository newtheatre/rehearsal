import { runSessionSweep } from '../utils/sessionSweep'

/**
 * Tomorrow's reminders and the unmarked-register nag, 09:00 UTC. Dry-run by
 * default like the expiry sweep: site_config.notifications_mode.
 */
export default defineTask({
  meta: {
    // Must match the file path: that is what Nitro registers it as.
    name: 'session-sweep',
    description: 'Remind people about tomorrow, and nag a lead whose register is unmarked',
  },
  async run() {
    const result = await runSessionSweep()
    return { result }
  },
})
