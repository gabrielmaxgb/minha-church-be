import { ChurchAccessGuard, RolesGuard } from './church-access.guard';

export const CHURCH_EVENT_MANAGER_ROLES = [
  'owner',
  'admin',
  'pastor',
] as const;

export const CHURCH_MEMBER_MANAGER_ROLES = [
  'owner',
  'admin',
  'pastor',
  'secretary',
] as const;

export const CHURCH_MINISTRY_MANAGER_ROLES = [
  'owner',
  'admin',
  'pastor',
] as const;

export const CHURCH_MEMBERSHIP_MANAGER_ROLES = [
  'owner',
  'admin',
  'pastor',
] as const;

export { ChurchAccessGuard, RolesGuard };
