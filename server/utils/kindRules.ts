/**
 * Kind decides three flags, so they can never contradict each other
 * (ADR-0003). No database import: the catalogue importer runs outside Nitro.
 */

export type Kind = 'MODULE' | 'CERTIFICATION' | 'BRIEF'

export function applyKindRules<T extends { kind: Kind, grantsSupervisor?: boolean, grantsTrainer?: boolean }>(input: T) {
  const isCertification = input.kind === 'CERTIFICATION'
  const isBrief = input.kind === 'BRIEF'
  return {
    ...input,
    signoffRequired: isCertification,
    grantsSupervisor: isCertification && Boolean(input.grantsSupervisor),
    grantsTrainer: isCertification && Boolean(input.grantsTrainer),
    // Briefs never expire and never gate, so the machinery must not model
    // something that recurs weekly.
    ...(isBrief ? { expiryMode: 'NONE' as const, expiryMonths: null } : {}),
  }
}
