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
  /** Conta Stripe Connect criada / onboarding iniciado. */
  connectOnboardingStarted: 'connect.onboarding_started',
  /** Link de onboarding Stripe reaberto. */
  connectOnboardingResumed: 'connect.onboarding_resumed',
  fiscalProfileUpdated: 'fiscal_profile.updated',
  givingFundCreated: 'giving_fund.created',
  givingFundUpdated: 'giving_fund.updated',
  givingFundDeleted: 'giving_fund.deleted',
  financeEntryCreated: 'finance_entry.created',
  financeEntryUpdated: 'finance_entry.updated',
  financeEntryDeleted: 'finance_entry.deleted',
  financialPeriodClosed: 'financial_period.closed',
  financialPeriodReopened: 'financial_period.reopened',
  givingDonationRefunded: 'giving_donation.refunded',
  eventTicketRefunded: 'event_ticket.refunded',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export const AUDIT_TARGET_TYPES = {
  church: 'church',
  churchRole: 'church_role',
  membership: 'membership',
  user: 'user',
  connectAccount: 'connect_account',
  fiscalProfile: 'fiscal_profile',
  givingFund: 'giving_fund',
  financeEntry: 'finance_entry',
  financialPeriod: 'financial_period',
  givingDonation: 'giving_donation',
  eventTicket: 'event_ticket',
} as const;
