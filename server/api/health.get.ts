/** GET /api/health — uptime check (public, docs/operations.md#monitoring). */
export default defineEventHandler(() => {
  return { ok: true, version: '0.1.0' }
})
