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
  private readonly stripeClient: Stripe | null;

  /** MCC 8661 = Religious Organizations (Stripe). */
  private static readonly CHURCH_MCC = '8661';

  private static readonly CHURCH_PRODUCT_DESCRIPTION =
    'Recebemos dízimos, ofertas e doações de membros da comunidade religiosa através da plataforma Minha Church.';

  private static readonly CHURCH_BUSINESS_URL = 'https://www.minhachurch.com';

  constructor(private readonly configService: ConfigService) {
    const secretKey =
      this.configService.get<string>('stripe.secretKey')?.trim() ?? '';
    const nodeEnv = this.configService.get<string>('nodeEnv') ?? 'development';

    if (!secretKey) {
      if (nodeEnv === 'production') {
        throw new Error(
          'STRIPE_SECRET_KEY é obrigatória em produção (preferir Restricted API Key rk_...).',
        );
      }
      this.logger.warn(
        'STRIPE_SECRET_KEY ausente — Connect/pagamentos falharão até configurar. Preferir rk_ (Restricted API Key) em vez de sk_.',
      );
      this.stripeClient = null;
    } else {
      if (secretKey.startsWith('sk_')) {
        this.logger.warn(
          'STRIPE_SECRET_KEY usa sk_ — prefira Restricted API Key (rk_) com least privilege.',
        );
      } else if (!secretKey.startsWith('rk_')) {
        this.logger.warn(
          'STRIPE_SECRET_KEY não parece sk_/rk_ — verifique a chave no Dashboard.',
        );
      }
      this.stripeClient = new Stripe(secretKey);
    }
  }

  /** Cliente Stripe; falha se a secret key não estiver configurada. */
  private get stripe(): Stripe {
    this.assertConfigured();
    return this.stripeClient!;
  }

  isConfigured(): boolean {
    return Boolean(
      this.stripeClient &&
        this.configService.get<string>('stripe.secretKey')?.trim(),
    );
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
    // `transfers` permanece solicitado no perfil Connect da plataforma.
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
   * Login link one-shot para o Express Dashboard da conta conectada.
   * Só funciona depois que o onboarding enviou os dados (`details_submitted`).
   */
  async createLoginLink(accountId: string): Promise<Stripe.LoginLink> {
    this.assertConfigured();

    try {
      return await this.stripe.accounts.createLoginLink(accountId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'erro desconhecido';
      this.logger.warn(
        `Falha ao criar login link Express para ${accountId}: ${message}`,
      );
      throw new BadRequestException(
        'Não foi possível abrir o painel Stripe. Conclua o cadastro de recebimentos e tente de novo.',
      );
    }
  }

  /**
   * Saldo da conta Connect (disponível vs. a liquidar).
   * Escopo: conta conectada — não é o saldo do banco da igreja.
   */
  async retrieveConnectBalance(
    stripeAccountId: string,
  ): Promise<Stripe.Balance> {
    this.assertConfigured();

    return this.stripe.balance.retrieve(
      {},
      { stripeAccount: stripeAccountId },
    );
  }

  /**
   * Repasses Stripe → conta bancária cadastrada na Connect.
   * Não inclui gastos feitos depois que o dinheiro caiu no banco.
   */
  async listConnectPayouts(
    stripeAccountId: string,
    options?: { limit?: number; startingAfter?: string },
  ): Promise<Stripe.ApiList<Stripe.Payout>> {
    this.assertConfigured();

    const limit = Math.min(Math.max(options?.limit ?? 20, 1), 100);

    return this.stripe.payouts.list(
      {
        limit,
        ...(options?.startingAfter
          ? { starting_after: options.startingAfter }
          : {}),
      },
      { stripeAccount: stripeAccountId },
    );
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
   *
   * Usa dynamic payment methods (`automatic_payment_methods`) e restringe
   * Pix/cartão/boleto via `excluded_payment_method_types` — nunca
   * `payment_method_types` (best practice Stripe).
   */
  async createPaymentIntent(params: {
    stripeAccountId: string;
    amountCents: number;
    currency?: string;
    applicationFeeAmount?: number;
    metadata: Record<string, string>;
    receiptEmail?: string;
    description?: string;
    /** Meios do produto permitidos neste checkout (pix, card, boleto). */
    allowedPaymentMethodTypes: Array<'pix' | 'card' | 'boleto'>;
    /** Chave de idempotência Stripe (ex.: donation/ticket id). */
    idempotencyKey: string;
  }): Promise<Stripe.PaymentIntent> {
    this.assertConfigured();

    if (params.allowedPaymentMethodTypes.length === 0) {
      throw new BadRequestException(
        'Nenhum meio de pagamento disponível para este fundo.',
      );
    }

    const allowed = new Set(params.allowedPaymentMethodTypes);
    const excludedPaymentMethodTypes = (
      ['pix', 'card', 'boleto'] as const
    ).filter((method) => !allowed.has(method));

    const createParams: Stripe.PaymentIntentCreateParams = {
      amount: params.amountCents,
      currency: params.currency ?? 'brl',
      automatic_payment_methods: { enabled: true },
      metadata: params.metadata,
      description: params.description,
      receipt_email: params.receiptEmail,
    };

    if (excludedPaymentMethodTypes.length > 0) {
      createParams.excluded_payment_method_types = [
        ...excludedPaymentMethodTypes,
      ];
    }

    if (
      typeof params.applicationFeeAmount === 'number' &&
      params.applicationFeeAmount > 0
    ) {
      createParams.application_fee_amount = params.applicationFeeAmount;
    }

    return this.stripe.paymentIntents.create(createParams, {
      stripeAccount: params.stripeAccountId,
      idempotencyKey: params.idempotencyKey,
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

  async cancelPaymentIntent(
    paymentIntentId: string,
    stripeAccountId: string,
  ): Promise<Stripe.PaymentIntent> {
    this.assertConfigured();

    return this.stripe.paymentIntents.cancel(
      paymentIntentId,
      {},
      { stripeAccount: stripeAccountId },
    );
  }

  /** Estorno total do PaymentIntent na conta conectada (direct charge). */
  async createRefund(params: {
    stripeAccountId: string;
    paymentIntentId: string;
    metadata?: Record<string, string>;
  }): Promise<Stripe.Refund> {
    this.assertConfigured();

    return this.stripe.refunds.create(
      {
        payment_intent: params.paymentIntentId,
        metadata: params.metadata,
      },
      { stripeAccount: params.stripeAccountId },
    );
  }

  async createCustomer(params: {
    stripeAccountId: string;
    email?: string | null;
    name?: string | null;
    metadata?: Record<string, string>;
  }): Promise<Stripe.Customer> {
    this.assertConfigured();

    return this.stripe.customers.create(
      {
        email: params.email ?? undefined,
        name: params.name ?? undefined,
        metadata: params.metadata,
      },
      { stripeAccount: params.stripeAccountId },
    );
  }

  /**
   * Subscription mensal na conta conectada (cartão).
   * Reusa Product (por fundo) + Price (por valor) via lookup_key.
   * Retorna subscription com latest_invoice.confirmation_secret
   * (API Basil+; payment_intent saiu do Invoice).
   * Expand máximo: 4 níveis — nunca latest_invoice.payments.data.payment.payment_intent.
   */
  async createGivingSubscription(params: {
    stripeAccountId: string;
    customerId: string;
    amountCents: number;
    currency?: string;
    fundId: string;
    productName: string;
    applicationFeePercent?: number;
    metadata: Record<string, string>;
    idempotencyKey: string;
  }): Promise<Stripe.Subscription> {
    this.assertConfigured();

    const currency = params.currency ?? 'brl';
    const priceId = await this.getOrCreateGivingPrice({
      stripeAccountId: params.stripeAccountId,
      fundId: params.fundId,
      productName: params.productName,
      amountCents: params.amountCents,
      currency,
      metadata: {
        minhachurch_fund_id: params.fundId,
        minhachurch_church_id:
          params.metadata.minhachurch_church_id ?? '',
      },
    });

    const createParams: Stripe.SubscriptionCreateParams = {
      customer: params.customerId,
      payment_behavior: 'default_incomplete',
      // Recorrência de doação = só cartão (produto). Pix/boleto não
      // funcionam bem como “débito automático” mensal; restringimos no
      // PaymentIntent da invoice para o Elements não oferecer boleto/Pix.
      // Doação avulsa continua com dynamic methods + excluded.
      payment_settings: {
        save_default_payment_method: 'on_subscription',
        payment_method_types: ['card'],
      },
      items: [{ price: priceId }],
      metadata: params.metadata,
      // Stripe limita expand a 4 níveis. Não use
      // latest_invoice.payments.data.payment.payment_intent (5 níveis).
      expand: [
        'latest_invoice.confirmation_secret',
        'latest_invoice.payments',
      ],
    };

    if (
      typeof params.applicationFeePercent === 'number' &&
      params.applicationFeePercent > 0
    ) {
      createParams.application_fee_percent = params.applicationFeePercent;
    }

    return this.stripe.subscriptions.create(createParams, {
      stripeAccount: params.stripeAccountId,
      idempotencyKey: params.idempotencyKey,
    });
  }

  /**
   * Um Product por fundo (metadata) + um Price por (fundo, valor, moeda, intervalo)
   * via lookup_key. Evita criar Product/Price ad hoc a cada assinatura.
   */
  private async getOrCreateGivingPrice(params: {
    stripeAccountId: string;
    fundId: string;
    productName: string;
    amountCents: number;
    currency: string;
    metadata: Record<string, string>;
  }): Promise<string> {
    const requestOpts = { stripeAccount: params.stripeAccountId };
    const priceLookupKey =
      `mc_giving_${params.fundId}_${params.amountCents}_${params.currency}_month`.slice(
        0,
        200,
      );

    const existingPrices = await this.stripe.prices.list(
      { lookup_keys: [priceLookupKey], active: true, limit: 1 },
      requestOpts,
    );
    if (existingPrices.data[0]) {
      return existingPrices.data[0].id;
    }

    const productId = await this.getOrCreateGivingProduct({
      stripeAccountId: params.stripeAccountId,
      fundId: params.fundId,
      productName: params.productName,
      metadata: params.metadata,
    });

    const price = await this.stripe.prices.create(
      {
        currency: params.currency,
        unit_amount: params.amountCents,
        recurring: { interval: 'month' },
        product: productId,
        lookup_key: priceLookupKey,
        metadata: params.metadata,
      },
      {
        ...requestOpts,
        idempotencyKey: `mc_price_${priceLookupKey}`.slice(0, 255),
      },
    );

    return price.id;
  }

  private async getOrCreateGivingProduct(params: {
    stripeAccountId: string;
    fundId: string;
    productName: string;
    metadata: Record<string, string>;
  }): Promise<string> {
    const existingId = await this.findProductIdByFundId(
      params.fundId,
      params.stripeAccountId,
    );
    if (existingId) {
      return existingId;
    }

    try {
      const product = await this.stripe.products.create(
        {
          name: params.productName,
          metadata: {
            ...params.metadata,
            minhachurch_fund_id: params.fundId,
          },
        },
        {
          stripeAccount: params.stripeAccountId,
          idempotencyKey: `mc_prod_fund_${params.fundId}`.slice(0, 255),
        },
      );
      return product.id;
    } catch (error) {
      const again = await this.findProductIdByFundId(
        params.fundId,
        params.stripeAccountId,
      );
      if (again) {
        return again;
      }
      throw error;
    }
  }

  private async findProductIdByFundId(
    fundId: string,
    stripeAccountId: string,
  ): Promise<string | null> {
    const requestOpts = { stripeAccount: stripeAccountId };

    try {
      const searched = await this.stripe.products.search(
        {
          query: `metadata['minhachurch_fund_id']:'${fundId}'`,
          limit: 1,
        },
        requestOpts,
      );
      if (searched.data[0]) {
        return searched.data[0].id;
      }
    } catch {
      // Search pode não estar disponível na conta conectada — fallback list.
    }

    let startingAfter: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const listed = await this.stripe.products.list(
        {
          active: true,
          limit: 100,
          ...(startingAfter ? { starting_after: startingAfter } : {}),
        },
        requestOpts,
      );
      const match = listed.data.find(
        (product) => product.metadata?.minhachurch_fund_id === fundId,
      );
      if (match) {
        return match.id;
      }
      if (!listed.has_more || listed.data.length === 0) {
        break;
      }
      startingAfter = listed.data[listed.data.length - 1]?.id;
    }

    return null;
  }

  async cancelSubscription(
    subscriptionId: string,
    stripeAccountId: string,
  ): Promise<Stripe.Subscription> {
    this.assertConfigured();

    return this.stripe.subscriptions.cancel(
      subscriptionId,
      {},
      { stripeAccount: stripeAccountId },
    );
  }

  async retrieveInvoice(
    invoiceId: string,
    stripeAccountId: string,
  ): Promise<Stripe.Invoice> {
    this.assertConfigured();

    return this.stripe.invoices.retrieve(
      invoiceId,
      {
        expand: [
          'confirmation_secret',
          'payments.data.payment.payment_intent',
        ],
      },
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
