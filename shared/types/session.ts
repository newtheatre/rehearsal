/**
 * The shape of GET /api/sessions/:id. Written out because a template-literal
 * URL degrades Nuxt's typed-route map to `{}`.
 */

export type SessionStatus = 'PLANNED' | 'OPEN' | 'FULL' | 'DELIVERED' | 'CANCELLED'
export type AttendeeStatus = 'SIGNED_UP' | 'CANCELLED' | 'ATTENDED' | 'ABSENT'

export interface SessionModuleSummary {
  id: string
  name: string
  kind: 'MODULE' | 'CERTIFICATION' | 'BRIEF'
}

export interface SessionAttendeeSummary {
  id: string
  name: string
  status: AttendeeStatus
  /** False while they are behind the capacity line. Derived, never stored. */
  hasPlace: boolean
}

export interface SessionDetail {
  id: string
  status: SessionStatus
  heldOn: string
  startsAt: string | null
  endsAt: string | null
  signupsCloseAt: string | null
  capacity: number | null
  location: string | null
  description: string | null
  notes: string | null
  cancelReason: string | null
  registerOpened: boolean
  trainerUserId: string
  trainerName: string
  modules: SessionModuleSummary[]
  /** Names are shown to whoever may steward the session, counts to everyone. */
  attendees: SessionAttendeeSummary[] | null
  signupCount: number
  placesLeft: number | null
  /** Where the acting user stands, for the sign-up button. */
  mine: {
    signedUp: boolean
    hasPlace: boolean
    waitlistPosition: number | null
  }
  /** Non-revoked records this session produced. */
  recordCount: number
  canSignUp: boolean
  signupBlockedReason: string | null
  canWithdraw: boolean
  canSteward: boolean
  canEdit: boolean
  editWindowDays: number
}
