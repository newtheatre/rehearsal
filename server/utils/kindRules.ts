/**
 * Kind decides the flags, so they can never contradict each other
 * (ADR-0003). No database import: the catalogue importer runs outside Nitro.
 */

export type Kind = 'MODULE' | 'CERTIFICATION' | 'BRIEF'

export function applyKindRules<T extends {
  kind: Kind
  grantsSupervisor?: boolean
  grantsTrainer?: boolean
  allowsExternal?: boolean
}>(input: T) {
  const isCertification = input.kind === 'CERTIFICATION'
  const isBrief = input.kind === 'BRIEF'
  return {
    ...input,
    signoffRequired: isCertification,
    grantsSupervisor: isCertification && Boolean(input.grantsSupervisor),
    grantsTrainer: isCertification && Boolean(input.grantsTrainer),
    // A brief recurs per event: it never expires, never gates, and nothing
    // outside can evidence attending one.
    ...(isBrief
      ? { expiryMode: 'NONE' as const, expiryMonths: null, allowsExternal: false, externalEvidence: null }
      : {}),
  }
}
