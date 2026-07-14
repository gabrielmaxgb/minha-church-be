import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChurchDocumentType, ConnectCapabilityStatus } from '@prisma/client';
import Stripe from 'stripe';

import type {
  ConnectAccountState,
  FiscalHintsFromStripe,
} from './payments.types';

export interface CreateConnectedAccountInput {
  churchId: string;
  documentType: ChurchDocumentType;
  documentNumber: string;
  legalName: string;
  responsibleName: string;
  responsibleDocument?: string | null;
  /** Opcionais: só prefixam o Stripe se já existirem (ex.: hydrate). */
  addressLine?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
}

/**
 * Wrapper isolado do Stripe Connect (Express).
 * Não compartilha estado com BillingService (billing SaaS) para evitar
 * misturar o Customer da plataforma com as contas conectadas das igrejas.
 */
@Injectable()
export class StripeConnectService {
  private readonly logger = new Logger(StripeConnectService.name);
  private readonly stripe: Stripe;

  /** MCC 8661 = Religious Organizations (Stripe). */
  private static readonly CHURCH_MCC = '8661';

  private static readonly CHURCH_PRODUCT_DESCRIPTION =
    'Recebemos dízimos, ofertas e doações de membros da comunidade religiosa, e pagamentos de inscrições em eventos da igreja, através da plataforma Minha Church.';

  private static readonly CHURCH_BUSINESS_URL = 'https://www.minhachurch.com';

  constructor(private readonly configService: ConfigService) {
    const secretKey = this.configService.get<string>('stripe.secretKey') ?? '';

    this.stripe = new Stripe(secretKey || 'sk_test_placeholder');
  }

  isConfigured(): boolean {
    return Boolean(this.configService.get<string>('stripe.secretKey'));
  }

  assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new BadRequestException(
        'Pagamentos ainda não configurados no servidor.',
      );
    }
  }

  private enabledMethods(): string[] {
    return (
      this.configService.get<string[]>('payments.enabledMethods') ?? [
        'pix',
        'card',
        'boleto',
      ]
    );
  }

  async createConnectedAccount(
    input: CreateConnectedAccountInput,
  ): Promise<Stripe.Account> {
    this.assertConfigured();

    const methods = this.enabledMethods();
    // `transfers` é necessário para destination charges nas próximas fases.
    const capabilities: Record<string, { requested: boolean }> = {
      transfers: { requested: true },
    };

    if (methods.includes('card')) {
      capabilities.card_payments = { requested: true };
    }
    if (methods.includes('boleto')) {
      capabilities.boleto_payments = { requested: true };
    }
    // Pix NÃO é requestable via API para contas Express em BR
    // ("pix_payments capability is not requestable"). Para Express o Pix é
    // controlado pelo default de métodos da plataforma (Payment methods) ou
    // ativado pela própria igreja no Express Dashboard. Por isso nunca pedimos
    // `pix_payments` aqui, mesmo que `pix` venha em PAYMENTS_ENABLED_METHODS.

    const isCompany = input.documentType === ChurchDocumentType.cnpj;
    const phone = input.contactPhone
      ? toE164BrPhone(input.contactPhone)
      : undefined;
    const hasAddress = Boolean(
      input.addressLine?.trim() &&
        input.city?.trim() &&
        input.state?.trim() &&
        input.zipCode?.replace(/\D/g, '').length === 8,
    );
    const address = hasAddress
      ? {
          line1: input.addressLine!.trim(),
          city: input.city!.trim(),
          state: input.state!.trim().toUpperCase(),
          postal_code: input.zipCode!.replace(/\D/g, ''),
          country: 'BR',
        }
      : undefined;
    const email = input.contactEmail?.trim().toLowerCase() || undefined;
    const { first_name, last_name } = splitPersonName(input.responsibleName);

    const params: Stripe.AccountCreateParams = {
      type: 'express',
      country: 'BR',
      business_type: isCompany ? 'company' : 'individual',
      capabilities:
        capabilities as unknown as Stripe.AccountCreateParams.Capabilities,
      metadata: { churchId: input.churchId },
      business_profile: {
        name: input.legalName.trim(),
        mcc: StripeConnectService.CHURCH_MCC,
        product_description: StripeConnectService.CHURCH_PRODUCT_DESCRIPTION,
        url: StripeConnectService.CHURCH_BUSINESS_URL,
        ...(email ? { support_email: email } : {}),
        ...(phone ? { support_phone: phone } : {}),
        ...(address ? { support_address: address } : {}),
      },
      ...(email ? { email } : {}),
      ...(isCompany
        ? {
            company: {
              name: input.legalName.trim(),
              tax_id: input.documentNumber.replace(/\D/g, ''),
              ...(phone ? { phone } : {}),
              ...(address ? { address } : {}),
            },
          }
        : {
            individual: {
              first_name,
              last_name,
              id_number: input.documentNumber.replace(/\D/g, ''),
              ...(email ? { email } : {}),
              ...(phone ? { phone } : {}),
              ...(address ? { address } : {}),
            },
          }),
    };

    const account = await this.stripe.accounts.create(params);

    // Prefill do representante legal (CNPJ) — Person com relationship.representative.
    if (isCompany) {
      const idNumber = (input.responsibleDocument ?? '').replace(/\D/g, '');

      try {
        await this.stripe.accounts.createPerson(account.id, {
          first_name,
          last_name,
          ...(email ? { email } : {}),
          ...(phone ? { phone } : {}),
          ...(idNumber ? { id_number: idNumber } : {}),
          ...(address ? { address } : {}),
          relationship: {
            representative: true,
            executive: true,
          },
        });
      } catch (error) {
        // Conta já criada; onboarding ainda funciona sem o Person prefixado.
        this.logger.warn(
          `Falha ao prefixar Person representante em ${account.id}: ${
            error instanceof Error ? error.message : 'erro desconhecido'
          }`,
        );
      }
    }

    return account;
  }

  async createAccountLink(
    accountId: string,
    returnUrl: string,
    refreshUrl: string,
  ): Promise<Stripe.AccountLink> {
    this.assertConfigured();

    await this.ensureChurchBusinessProfile(accountId);

    return this.stripe.accountLinks.create({
      account: accountId,
      type: 'account_onboarding',
      return_url: returnUrl,
      refresh_url: refreshUrl,
      collection_options: { fields: 'eventually_due' },
    });
  }

  /**
   * Prefixa o perfil de negócio como organização religiosa (MCC 8661).
   * Rodado na criação e antes do Account Link, pra o onboarding hospedado
   * não parecer e-commerce genérico.
   */
  async ensureChurchBusinessProfile(
    accountId: string,
    legalName?: string | null,
  ): Promise<void> {
    this.assertConfigured();

    try {
      await this.stripe.accounts.update(accountId, {
        business_profile: {
          mcc: StripeConnectService.CHURCH_MCC,
          product_description: StripeConnectService.CHURCH_PRODUCT_DESCRIPTION,
          url: StripeConnectService.CHURCH_BUSINESS_URL,
          ...(legalName?.trim() ? { name: legalName.trim() } : {}),
        },
      });
    } catch (error) {
      this.logger.warn(
        `Falha ao prefixar business_profile religioso em ${accountId}: ${
          error instanceof Error ? error.message : 'erro desconhecido'
        }`,
      );
    }
  }

  async retrieveAccount(accountId: string): Promise<Stripe.Account> {
    this.assertConfigured();

    return this.stripe.accounts.retrieve(accountId);
  }

  /**
   * Direct charge na conta conectada (igreja = MoR).
   * `application_fee_amount` opcional (taxa da plataforma em centavos).
   */
  async createPaymentIntent(params: {
    stripeAccountId: string;
    amountCents: number;
    currency?: string;
    applicationFeeAmount?: number;
    metadata: Record<string, string>;
    receiptEmail?: string;
    description?: string;
    /** Stripe payment_method_types to allow (pix, card, boleto). */
    paymentMethodTypes: Array<'pix' | 'card' | 'boleto'>;
  }): Promise<Stripe.PaymentIntent> {
    this.assertConfigured();

    if (params.paymentMethodTypes.length === 0) {
      throw new BadRequestException(
        'Nenhum meio de pagamento disponível para este fundo.',
      );
    }

    const createParams: Stripe.PaymentIntentCreateParams = {
      amount: params.amountCents,
      currency: params.currency ?? 'brl',
      payment_method_types: params.paymentMethodTypes,
      metadata: params.metadata,
      description: params.description,
      receipt_email: params.receiptEmail,
    };

    if (
      typeof params.applicationFeeAmount === 'number' &&
      params.applicationFeeAmount > 0
    ) {
      createParams.application_fee_amount = params.applicationFeeAmount;
    }

    return this.stripe.paymentIntents.create(createParams, {
      stripeAccount: params.stripeAccountId,
    });
  }

  async retrievePaymentIntent(
    paymentIntentId: string,
    stripeAccountId: string,
  ): Promise<Stripe.PaymentIntent> {
    this.assertConfigured();

    return this.stripe.paymentIntents.retrieve(
      paymentIntentId,
      {},
      { stripeAccount: stripeAccountId },
    );
  }

  getPublishableKey(): string {
    return this.configService.get<string>('stripe.publishableKey') ?? '';
  }

  constructWebhookEvent(
    rawBody: Buffer,
    signature: string,
  ): Stripe.Event {
    const webhookSecret = this.configService.get<string>(
      'stripe.connectWebhookSecret',
    );

    if (!webhookSecret) {
      throw new BadRequestException(
        'Webhook do Connect não configurado no servidor.',
      );
    }

    return this.stripe.webhooks.constructEvent(
      rawBody,
      signature,
      webhookSecret,
    );
  }

  /**
   * Extrai o subset fiscal que o Stripe ainda devolve em contas Express
   * (`requirement_collection: stripe`). CNPJ/CPF e responsável NÃO vêm — só
   * nome de negócio e, às vezes, contato/endereço de suporte.
   */
  extractFiscalHints(account: Stripe.Account): FiscalHintsFromStripe {
    const profile = account.business_profile;
    const supportAddress = profile?.support_address;
    const companyName =
      account.company && 'name' in account.company
        ? (account.company.name ?? null)
        : null;

    const legalName =
      emptyToNull(companyName) ?? emptyToNull(profile?.name ?? null);

    const documentType =
      account.business_type === 'individual'
        ? ChurchDocumentType.cpf
        : account.business_type === 'company'
          ? ChurchDocumentType.cnpj
          : null;

    return {
      legalName,
      contactEmail:
        emptyToNull(account.email) ??
        emptyToNull(profile?.support_email ?? null),
      contactPhone: emptyToNull(profile?.support_phone ?? null),
      addressLine: emptyToNull(supportAddress?.line1 ?? null),
      city: emptyToNull(supportAddress?.city ?? null),
      state: emptyToNull(supportAddress?.state ?? null),
      zipCode: emptyToNull(supportAddress?.postal_code ?? null),
      documentType,
    };
  }

  /** Deriva um estado normalizado (persistível/exibível) a partir da Stripe.Account. */
  mapAccountToState(account: Stripe.Account): ConnectAccountState {
    const requirements = account.requirements;
    const disabledReason = requirements?.disabled_reason ?? null;
    const currentlyDue = requirements?.currently_due ?? [];
    const pastDue = requirements?.past_due ?? [];

    const chargesEnabled = Boolean(account.charges_enabled);
    const payoutsEnabled = Boolean(account.payouts_enabled);
    const detailsSubmitted = Boolean(account.details_submitted);

    const capabilityRecord = (account.capabilities ?? {}) as Record<
      string,
      Stripe.Account.Capabilities[keyof Stripe.Account.Capabilities]
    >;

    const readCapability = (key: string): ConnectCapabilityStatus => {
      const value = capabilityRecord[key];

      if (value === 'active') {
        return ConnectCapabilityStatus.active;
      }
      if (value === 'pending') {
        return ConnectCapabilityStatus.pending;
      }
      return ConnectCapabilityStatus.inactive;
    };

    let onboardingStatus: ConnectAccountState['onboardingStatus'];

    if (chargesEnabled) {
      onboardingStatus = 'active';
    } else if (disabledReason && disabledReason.startsWith('rejected')) {
      onboardingStatus = 'rejected';
    } else if (detailsSubmitted) {
      const blocked =
        pastDue.length > 0 ||
        (disabledReason !== null &&
          disabledReason !== 'requirements.pending_verification');
      onboardingStatus = blocked ? 'restricted' : 'verifying';
    } else {
      onboardingStatus = 'onboarding';
    }

    return {
      onboardingStatus,
      chargesEnabled,
      payoutsEnabled,
      detailsSubmitted,
      capabilities: {
        pix: readCapability('pix_payments'),
        card: readCapability('card_payments'),
        boleto: readCapability('boleto_payments'),
      },
      requirementsDue: [...new Set([...currentlyDue, ...pastDue])],
      disabledReason,
    };
  }
}

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function splitPersonName(fullName: string): {
  first_name: string;
  last_name: string;
} {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return { first_name: 'Responsavel', last_name: 'Legal' };
  }

  if (parts.length === 1) {
    return { first_name: parts[0], last_name: parts[0] };
  }

  return {
    first_name: parts[0],
    last_name: parts.slice(1).join(' '),
  };
}

/** Normaliza telefone BR para E.164 quando possível. */
function toE164BrPhone(value: string): string {
  const digits = value.replace(/\D/g, '');

  if (digits.startsWith('55') && digits.length >= 12) {
    return `+${digits}`;
  }

  if (digits.length === 10 || digits.length === 11) {
    return `+55${digits}`;
  }

  return value.trim();
}
