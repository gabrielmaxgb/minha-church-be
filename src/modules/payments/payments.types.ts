import type {
  ChurchDocumentType,
  ConnectCapabilityStatus,
  ConnectOnboardingStatus,
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

export interface GivingFundResult {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  isActive: boolean;
  /** false quando já existem doações — exclusão bloqueada, só desativar. */
  canDelete: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface PublicGivingFundResult {
  churchName: string;
  churchSlug: string;
  fundName: string;
  fundSlug: string;
  fundDescription: string | null;
  currency: 'brl';
  minAmountCents: number;
  maxAmountCents: number;
}

export interface GivingCheckoutResult {
  donationId: string;
  clientSecret: string;
  stripeAccountId: string;
  publishableKey: string;
  amountCents: number;
  currency: 'brl';
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
  createdAt: string;
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
