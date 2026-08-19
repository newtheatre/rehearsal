/**
 * ⚠️ The `0.` prefix is load-bearing: this must hydrate the session password
 * before any plugin reads a session (stage-door ADR-0016).
 */
interface SecretsStoreSecret {
  get: () => Promise<string>
}

// One read per isolate, so a rotation only reaches a running isolate when it
// is recycled.
let sessionPassword: Promise<string> | undefined
let warnedAboutWorkerSecret = false

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('request', async (event) => {
    const env = event.context.cloudflare?.env as unknown as
      | Record<string, SecretsStoreSecret | undefined>
      | undefined
    const secret = env?.SESSION_PASSWORD
    if (!secret) return

    // A leftover worker secret of this name beats the store and the key mismatch
    // looks nothing like its cause, so warn loudly.
    if (!warnedAboutWorkerSecret && process.env.NUXT_SESSION_PASSWORD) {
      warnedAboutWorkerSecret = true
      console.error(
        '[secrets-store] NUXT_SESSION_PASSWORD is set as a worker secret and takes '
        + 'priority over the SESSION_PASSWORD store binding — this app is sealing '
        + 'sessions with the wrong key. Run `wrangler secret delete '
        + 'NUXT_SESSION_PASSWORD --name rehearsal`, then redeploy.',
      )
    }

    try {
      sessionPassword ??= secret.get()
      const value = await sessionPassword
      // An empty read is a failed read: pinning it seals every session in
      // this isolate with the wrong key, silently (stage-door ADR-0016).
      if (!value) throw new Error('SESSION_PASSWORD resolved empty')
      useRuntimeConfig(event).session.password = value
    }
    catch (error) {
      // Don't pin a failed read for the life of the isolate.
      sessionPassword = undefined
      console.error('[secrets-store] could not read SESSION_PASSWORD', error)
    }
  })
})
