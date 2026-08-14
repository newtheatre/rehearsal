/**
 * The shape of `GET /api/sessions/:id`.
 *
 * Declared here rather than inferred because the page fetches a
 * template-literal URL (`/api/sessions/${id}`), which Nuxt's typed-route map
 * cannot resolve — it degrades to `{}` and every property access becomes an
 * error. Writing the contract down once is better than casting at the call
 * site: the handler is checked against it too, so the two cannot drift.
 */

export interface SessionModuleSummary {
  id: string
  name: string
  kind: 'MODULE' | 'CERTIFICATION' | 'BRIEF'
}

export interface SessionAttendeeSummary {
  id: string
  name: string
}

export interface SessionDetail {
  id: string
  heldOn: string
  location: string | null
  notes: string | null
  trainerUserId: string
  trainerName: string
  modules: SessionModuleSummary[]
  attendees: SessionAttendeeSummary[]
  /** Non-revoked records this session produced. */
  recordCount: number
  canEdit: boolean
  editWindowDays: number
}
