import { Resend } from 'resend'

let client: Resend | null | undefined

/**
 * Returns null rather than throwing when no key is set, so email degrades to
 * a console log. Same shape as stage-door's — change it there and re-copy.
 */
export function getResend(): Resend | null {
  if (client !== undefined) return client

  const key = useRuntimeConfig().resendApiKey
  if (!key) {
    client = null
    return null
  }

  client = new Resend(key)
  return client
}

/** Test seam — the client is memoised per isolate. */
export function resetResendClient(): void {
  client = undefined
}
