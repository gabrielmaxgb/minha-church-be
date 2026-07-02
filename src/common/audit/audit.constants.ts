export const AUDIT_ACTIONS = {
  churchRoleCreated: 'church_role.created',
  churchRoleUpdated: 'church_role.updated',
  churchRoleDeleted: 'church_role.deleted',
  membershipUpdated: 'membership.updated',
  membershipPasswordReset: 'membership.password_reset',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export const AUDIT_TARGET_TYPES = {
  churchRole: 'church_role',
  membership: 'membership',
  user: 'user',
} as const;
