/**
 * What this app declares to the auth service. The namespace is `training`, not
 * `rehearsal`: it matches the domain, and it is the one place that string lives.
 */

export const APP_MANIFEST = {
  contract: 1,
  namespace: 'training',
  version: '1',

  // Only what the auth-service role grants. Department leadership and trainer
  // standing are app data, not roles (docs/permissions.md).
  permissions: [
    { key: 'module.manage', description: 'Create, edit and retire catalogue modules' },
    { key: 'record.manage', description: 'Award, amend and revoke training records for anyone' },
    { key: 'signoff.any', description: 'Sign off certifications in any department, not just one\'s own' },
    { key: 'config.manage', description: 'Edit site configuration, eligibility rules and service tokens' },
  ],

  roles: [
    {
      role: 'ADMIN',
      description: 'Training system admin. Theatre Manager and IT Manager.',
      defaultExpiry: { kind: 'committee-year' },
      permissions: ['module.manage', 'record.manage', 'signoff.any', 'config.manage'],
      requiresEligibility: null,
    },
  ],
} as const

export type AppManifest = typeof APP_MANIFEST
