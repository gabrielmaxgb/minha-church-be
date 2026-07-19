import type {
  ChurchDocumentType,
  ConnectCapabilityStatus,
  ConnectOnboardingStatus,
  GivingFundAudience,
} from '@prisma/client';

export interface FiscalProfileResult {
  documentType: ChurchDocumentType;
  documentNumber: string;
  legalName: string;
  responsibleName: string;
  responsibleDocument: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  updatedAt: string;
}

export interface ConnectCapabilities {
  pix: ConnectCapabilityStatus;
  card: ConnectCapabilityStatus;
  boleto: ConnectCapabilityStatus;
}

/** Estado derivado de uma Stripe.Account, pronto para persistência/exibição. */
export interface ConnectAccountState {
  onboardingStatus: ConnectOnboardingStatus;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  capabilities: ConnectCapabilities;
  requirementsDue: string[];
  disabledReason: string | null;
}

export interface ConnectStatusResult extends ConnectAccountState {
  hasAccount: boolean;
  /** true quando a igreja já pode receber pagamentos (charges_enabled). */
  canReceivePayments: boolean;
  lastSyncedAt: string | null;
}

export interface GivingFundPaymentMethods {
  pix: boolean;
  card: boolean;
  boleto: boolean;
}

export interface GivingFundResult {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  audience: GivingFundAudience;
  paymentMethods: GivingFundPaymentMethods;
  isActive: boolean;
  /** false quando já existem doações — exclusão bloqueada, só desativar. */
  canDelete: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface MemberGivingFundResult {
  id: string;
  name: string;
  description: string | null;
  paymentMethods: GivingFundPaymentMethods;
  currency: 'brl';
  minAmountCents: number;
  maxAmountCents: number;
}

export interface PaymentsSummaryResult {
  canReceivePayments: boolean;
  onboardingStatus: ConnectOnboardingStatus | 'none';
  activeFundsCount: number;
  memberFundsCount: number;
  publicFundsCount: number;
  succeededDonationsCount: number;
  succeededAmountCentsLast30Days: number;
}

export interface PublicGivingFundResult {
  churchName: string;
  churchSlug: string;
  fundName: string;
  fundSlug: string;
  fundDescription: string | null;
  paymentMethods: GivingFundPaymentMethods;
  currency: 'brl';
  minAmountCents: number;
  maxAmountCents: number;
}

export interface GivingCheckoutResult {
  donationId: string;
  /** Token de acesso ao recibo público (expira). */
  receiptToken: string;
  subscriptionId?: string | null;
  mode: 'payment' | 'subscription';
  clientSecret: string;
  stripeAccountId: string;
  publishableKey: string;
  amountCents: number;
  currency: 'brl';
}

export interface GivingSubscriptionResult {
  id: string;
  fundId: string;
  fundName: string;
  amountCents: number;
  currency: string;
  status: string;
  payerName: string | null;
  payerEmail: string | null;
  donorMemberId: string | null;
  donorMemberName: string | null;
  canceledAt: string | null;
  createdAt: string;
}

/**
 * Estado exibido após checkout — derivado do status real da doação
 * (sincronizado com o PaymentIntent do Stripe, não do redirect_status).
 */
export type GivingDonationOutcome =
  | 'succeeded'
  | 'processing'
  | 'incomplete'
  | 'failed';

export interface GivingDonationReceiptResult {
  donationId: string;
  status: string;
  outcome: GivingDonationOutcome;
  amountCents: number;
  currency: string;
  fundName: string;
}

export interface GivingDonationResult {
  id: string;
  fundId: string;
  fundName: string;
  amountCents: number;
  currency: string;
  status: string;
  payerName: string | null;
  payerEmail: string | null;
  donorMemberId: string | null;
  donorMemberName: string | null;
  createdAt: string;
}

export interface GivingDonationListResult {
  items: GivingDonationResult[];
  page: number;
  limit: number;
  total: number;
}

export interface ListGivingDonationsOptions {
  fundId?: string;
  status?: string;
  memberId?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export interface FinanceEntryResult {
  id: string;
  type: string;
  amountCents: number;
  currency: string;
  occurredOn: string;
  category: string;
  accountId: string | null;
  accountName: string | null;
  fundId: string | null;
  fundName: string | null;
  method: string;
  note: string | null;
  createdByUserId: string | null;
  createdByUserName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FinanceEntryListResult {
  items: FinanceEntryResult[];
  page: number;
  limit: number;
  total: number;
}

export interface ListFinanceEntriesOptions {
  type?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export interface FinanceEntriesSummaryResult {
  incomeCents: number;
  expenseCents: number;
  balanceCents: number;
  onlineDonationCents: number;
  /** Inscrições pagas de eventos (EventTicketPurchase succeeded) no período. */
  eventTicketCents: number;
}

export interface EventTicketPurchaseResult {
  id: string;
  eventId: string;
  eventName: string;
  amountCents: number;
  currency: string;
  status: string;
  buyerName: string | null;
  buyerEmail: string | null;
  memberId: string | null;
  memberName: string | null;
  createdAt: string;
}

export interface EventTicketPurchaseListResult {
  items: EventTicketPurchaseResult[];
  page: number;
  limit: number;
  total: number;
}

export interface ListEventTicketPurchasesOptions {
  eventId?: string;
  status?: string;
  memberId?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

/** Status de um repasse Stripe → banco (Payout). */
export type ConnectPayoutStatus =
  | 'paid'
  | 'pending'
  | 'in_transit'
  | 'canceled'
  | 'failed';

export interface ConnectPayoutResult {
  id: string;
  amountCents: number;
  currency: string;
  status: ConnectPayoutStatus;
  /** Data estimada de chegada no banco (ISO date YYYY-MM-DD). */
  arrivalDate: string;
  createdAt: string;
  method: string;
  description: string | null;
  failureMessage: string | null;
}

export interface ConnectBalanceAmount {
  amountCents: number;
  currency: string;
}

/**
 * Visão read-only do dinheiro na conta Connect e dos repasses ao banco.
 * Não representa gastos da igreja nem extrato bancário.
 */
export interface ConnectPayoutsOverviewResult {
  payoutsEnabled: boolean;
  /** Saldo liberado na Connect, ainda não enviado ao banco. */
  available: ConnectBalanceAmount[];
  /** Saldo ainda em liquidação na Connect. */
  pending: ConnectBalanceAmount[];
  payouts: ConnectPayoutResult[];
  hasMore: boolean;
}

/** Campos que o Stripe Express ainda devolve após o onboarding (subset). */
export interface FiscalHintsFromStripe {
  legalName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  /** Inferido de business_type quando disponível. */
  documentType: ChurchDocumentType | null;
}
