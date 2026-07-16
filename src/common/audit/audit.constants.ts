export const AUDIT_ACTIONS = {
  churchRegistered: 'church.registered',
  churchRoleCreated: 'church_role.created',
  churchRoleUpdated: 'church_role.updated',
  churchRoleDeleted: 'church_role.deleted',
  membershipUpdated: 'membership.updated',
  membershipPasswordReset: 'membership.password_reset',
  termsAccepted: 'terms.accepted',
  dpaAccepted: 'dpa.accepted',
  privacyPurged: 'privacy.purged',
  churchClosureRequested: 'church.closure_requested',
  churchClosureCancelled: 'church.closure_cancelled',
  userAccountDeleted: 'user.account_deleted',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export const AUDIT_TARGET_TYPES = {
  church: 'church',
  churchRole: 'church_role',
  membership: 'membership',
  user: 'user',
} as const;
