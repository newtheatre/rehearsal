/**
 * The shape of GET /api/sessions/:id. Written out because a template-literal
 * URL degrades Nuxt's typed-route map to `{}`.
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
