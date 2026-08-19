/**
 * Routes raise 422s carrying structured `data` (missing prerequisites,
 * blocking gaps), so prefer the server's message over a local fallback.
 */
export function errorMessage(e: unknown, fallback: string): string {
  const err = e as { statusMessage?: string, data?: { message?: string, statusMessage?: string } }
  return err.data?.statusMessage || err.data?.message || err.statusMessage || fallback
}
