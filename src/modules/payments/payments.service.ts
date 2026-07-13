import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ChurchDocumentType,
  ConnectCapabilityStatus,
  ConnectOnboardingStatus,
  GivingDonationStatus,
  Prisma,
} from '@prisma/client';
import type Stripe from 'stripe';

import { isValidCnpj, normalizeCnpj } from '../../common/utils/cnpj';
import { isValidCpf, normalizeCpf } from '../../common/utils/cpf';
import { PrismaService } from '../../database/prisma.service';
import { UpsertFiscalProfileDto } from './dto/upsert-fiscal-profile.dto';
import {
  CreateGivingCheckoutDto,
  GIVING_MAX_AMOUNT_CENTS,
  GIVING_MIN_AMOUNT_CENTS,
} from './dto/create-giving-checkout.dto';
import {
  CreateGivingFundDto,
  UpdateGivingFundDto,
} from './dto/giving-fund.dto';
import { isOwnerOnboardingMinimumComplete } from './fiscal-profile-completeness';
import { StripeConnectService } from './stripe-connect.service';
import type {
  ConnectStatusResult,
  FiscalProfileResult,
  GivingCheckoutResult,
  GivingDonationResult,
  GivingFundResult,
  PublicGivingFundResult,
} from './payments.types';

const CONNECT_RETURN_PATH =
  '/app/configuracoes?section=recebimentos&connect=return';
const CONNECT_REFRESH_PATH =
  '/app/configuracoes?section=recebimentos&connect=refresh';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly stripeConnect: StripeConnectService,
  ) {}

  async getFiscalProfile(
    churchId: string,
  ): Promise<FiscalProfileResult | null> {
    const profile = await this.prisma.churchFiscalProfile.findUnique({
      where: { churchId },
    });

    return profile ? this.toFiscalProfileResult(profile) : null;
  }

  async upsertFiscalProfile(
    churchId: string,
    dto: UpsertFiscalProfileDto,
  ): Promise<FiscalProfileResult> {
    const church = await this.prisma.church.findUnique({
      where: { id: churchId },
      select: { id: true },
    });

    if (!church) {
      throw new NotFoundException('Igreja não encontrada.');
    }

    const documentType =
      dto.documentType === 'cnpj'
        ? ChurchDocumentType.cnpj
        : ChurchDocumentType.cpf;

    const documentNumber = this.normalizeAndValidateDocument(
      documentType,
      dto.documentNumber,
    );

    if (documentType === ChurchDocumentType.cpf && dto.confirmNoCnpj !== true) {
      throw new BadRequestException(
        'Confirme que a igreja não possui CNPJ antes de cadastrar com CPF.',
      );
    }

    const responsibleDocument =
      documentType === ChurchDocumentType.cnpj
        ? this.normalizeAndValidateDocument(
            ChurchDocumentType.cpf,
            dto.responsibleDocument ?? '',
          )
        : dto.responsibleDocument?.trim()
          ? this.normalizeAndValidateDocument(
              ChurchDocumentType.cpf,
              dto.responsibleDocument,
            )
          : null;

    const contactPhone = dto.contactPhone.replace(/\D/g, '');
    if (contactPhone.length < 10 || contactPhone.length > 11) {
      throw new BadRequestException('Informe um telefone válido com DDD.');
    }

    const state = dto.state.trim().toUpperCase();
    const city = dto.city.trim();
    if (city.length < 2) {
      throw new BadRequestException('Informe a cidade da igreja.');
    }

    const data = {
      documentType,
      documentNumber,
      legalName: dto.legalName.trim(),
      responsibleName: dto.responsibleName.trim(),
      responsibleDocument,
      contactPhone,
      city,
      state,
      ...(dto.addressLine !== undefined
        ? { addressLine: dto.addressLine.trim() || null }
        : {}),
      ...(dto.zipCode !== undefined
        ? { zipCode: dto.zipCode.replace(/\D/g, '') || null }
        : {}),
      ...(dto.contactEmail !== undefined
        ? { contactEmail: dto.contactEmail.trim().toLowerCase() || null }
        : {}),
    };

    const profile = await this.prisma.churchFiscalProfile.upsert({
      where: { churchId },
      create: { churchId, ...data },
      update: data,
    });

    return this.toFiscalProfileResult(profile);
  }

  async getConnectStatus(churchId: string): Promise<ConnectStatusResult> {
    const account = await this.prisma.churchPaymentAccount.findUnique({
      where: { churchId },
    });

    if (!account) {
      return {
        hasAccount: false,
        canReceivePayments: false,
        onboardingStatus: ConnectOnboardingStatus.none,
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
        capabilities: {
          pix: ConnectCapabilityStatus.inactive,
          card: ConnectCapabilityStatus.inactive,
          boleto: ConnectCapabilityStatus.inactive,
        },
        requirementsDue: [],
        disabledReason: null,
        lastSyncedAt: null,
      };
    }

    return this.toConnectStatusResult(account);
  }

  async listGivingFunds(
    churchId: string,
    options?: { includeInactive?: boolean },
  ): Promise<GivingFundResult[]> {
    const funds = await this.prisma.givingFund.findMany({
      where: {
        churchId,
        ...(options?.includeInactive ? {} : { isActive: true }),
      },
      include: {
        _count: { select: { donations: true } },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    return funds.map((fund) => this.toGivingFundResult(fund));
  }

  async createGivingFund(
    churchId: string,
    dto: CreateGivingFundDto,
  ): Promise<GivingFundResult> {
    const church = await this.prisma.church.findUnique({
      where: { id: churchId },
      select: { id: true, fiscalProfile: true },
    });

    if (!church) {
      throw new NotFoundException('Igreja não encontrada.');
    }

    if (!isOwnerOnboardingMinimumComplete(church.fiscalProfile)) {
      throw new BadRequestException(
        'Complete o perfil da igreja (contato, cidade/UF e dados fiscais) antes de criar fundos de contribuição.',
      );
    }

    const name = dto.name.trim();
    const slug = await this.allocateFundSlug(churchId, name);
    const maxSort = await this.prisma.givingFund.aggregate({
      where: { churchId },
      _max: { sortOrder: true },
    });

    const fund = await this.prisma.givingFund.create({
      data: {
        churchId,
        name,
        slug,
        description: emptyToNull(dto.description),
        sortOrder: dto.sortOrder ?? (maxSort._max.sortOrder ?? -1) + 1,
      },
      include: {
        _count: { select: { donations: true } },
      },
    });

    return this.toGivingFundResult(fund);
  }

  async updateGivingFund(
    churchId: string,
    fundId: string,
    dto: UpdateGivingFundDto,
  ): Promise<GivingFundResult> {
    const existing = await this.prisma.givingFund.findFirst({
      where: { id: fundId, churchId },
      include: {
        _count: { select: { donations: true } },
      },
    });

    if (!existing) {
      throw new NotFoundException('Fundo não encontrado.');
    }

    const data: Prisma.GivingFundUpdateInput = {};

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      data.name = name;
      if (name !== existing.name) {
        data.slug = await this.allocateFundSlug(churchId, name, fundId);
      }
    }

    if (dto.description !== undefined) {
      data.description = emptyToNull(dto.description ?? undefined);
    }

    if (dto.isActive !== undefined) {
      data.isActive = dto.isActive;
    }

    if (dto.sortOrder !== undefined) {
      data.sortOrder = dto.sortOrder;
    }

    const fund = await this.prisma.givingFund.update({
      where: { id: fundId },
      data,
      include: {
        _count: { select: { donations: true } },
      },
    });

    return this.toGivingFundResult(fund);
  }

  async listGivingDonations(
    churchId: string,
    options?: { limit?: number },
  ): Promise<GivingDonationResult[]> {
    const limit = Math.min(Math.max(options?.limit ?? 50, 1), 100);

    const donations = await this.prisma.givingDonation.findMany({
      where: { churchId },
      include: {
        fund: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return donations.map((donation) => ({
      id: donation.id,
      fundId: donation.fund.id,
      fundName: donation.fund.name,
      amountCents: donation.amountCents,
      currency: donation.currency,
      status: donation.status,
      payerName: donation.payerName,
      payerEmail: donation.payerEmail,
      createdAt: donation.createdAt.toISOString(),
    }));
  }

  async deleteGivingFund(
    churchId: string,
    fundId: string,
  ): Promise<{ ok: true }> {
    const existing = await this.prisma.givingFund.findFirst({
      where: { id: fundId, churchId },
      include: {
        _count: { select: { donations: true } },
      },
    });

    if (!existing) {
      throw new NotFoundException('Fundo não encontrado.');
    }

    if (existing._count.donations > 0) {
      throw new ConflictException(
        'Este fundo já recebeu contribuições. Desative-o em vez de excluir, para preservar o histórico.',
      );
    }

    await this.prisma.givingFund.delete({ where: { id: fundId } });

    return { ok: true };
  }

  async getPublicGivingFund(
    churchSlug: string,
    fundSlug: string,
  ): Promise<PublicGivingFundResult> {
    const context = await this.resolvePublicGivingContext(churchSlug, fundSlug);

    return {
      churchName: context.church.name,
      churchSlug: context.church.slug,
      fundName: context.fund.name,
      fundSlug: context.fund.slug,
      fundDescription: context.fund.description,
      currency: 'brl',
      minAmountCents: GIVING_MIN_AMOUNT_CENTS,
      maxAmountCents: GIVING_MAX_AMOUNT_CENTS,
    };
  }

  async createGivingCheckout(
    churchSlug: string,
    fundSlug: string,
    dto: CreateGivingCheckoutDto,
  ): Promise<GivingCheckoutResult> {
    this.stripeConnect.assertConfigured();

    const publishableKey = this.stripeConnect.getPublishableKey();
    if (!publishableKey) {
      throw new BadRequestException(
        'Chave pública do Stripe não configurada no servidor.',
      );
    }

    const context = await this.resolvePublicGivingContext(churchSlug, fundSlug);
    const payerName = emptyToNull(dto.payerName);
    const payerEmail = emptyToNull(dto.payerEmail)?.toLowerCase() ?? null;

    const donation = await this.prisma.givingDonation.create({
      data: {
        churchId: context.church.id,
        fundId: context.fund.id,
        amountCents: dto.amountCents,
        currency: 'brl',
        status: GivingDonationStatus.pending,
        payerName,
        payerEmail,
      },
    });

    const feeBps =
      this.configService.get<number>('payments.platformFeeBps') ?? 0;
    const applicationFeeAmount =
      feeBps > 0 ? Math.floor((dto.amountCents * feeBps) / 10_000) : 0;

    try {
      const paymentIntent = await this.stripeConnect.createPaymentIntent({
        stripeAccountId: context.stripeAccountId,
        amountCents: dto.amountCents,
        applicationFeeAmount,
        receiptEmail: payerEmail ?? undefined,
        description: `${context.fund.name} — ${context.church.name}`,
        metadata: {
          minhachurch_donation_id: donation.id,
          minhachurch_church_id: context.church.id,
          minhachurch_fund_id: context.fund.id,
          minhachurch_fund_slug: context.fund.slug,
        },
      });

      if (!paymentIntent.client_secret) {
        throw new BadRequestException(
          'Não foi possível iniciar o pagamento. Tente novamente.',
        );
      }

      await this.prisma.givingDonation.update({
        where: { id: donation.id },
        data: {
          stripePaymentIntentId: paymentIntent.id,
          status: mapPaymentIntentStatus(paymentIntent.status),
        },
      });

      return {
        donationId: donation.id,
        clientSecret: paymentIntent.client_secret,
        stripeAccountId: context.stripeAccountId,
        publishableKey,
        amountCents: dto.amountCents,
        currency: 'brl',
      };
    } catch (error) {
      await this.prisma.givingDonation.update({
        where: { id: donation.id },
        data: { status: GivingDonationStatus.failed },
      });

      if (error instanceof BadRequestException) {
        throw error;
      }

      this.logger.error(
        `Falha ao criar PaymentIntent para doação ${donation.id}: ${
          error instanceof Error ? error.message : 'erro desconhecido'
        }`,
      );
      throw new BadRequestException(
        'Não foi possível iniciar o pagamento. Tente novamente.',
      );
    }
  }

  async startConnectOnboarding(churchId: string): Promise<{ url: string }> {
    this.stripeConnect.assertConfigured();

    const church = await this.prisma.church.findUnique({
      where: { id: churchId },
      select: { id: true, name: true, fiscalProfile: true },
    });

    if (!church) {
      throw new NotFoundException('Igreja não encontrada.');
    }

    const existing = await this.prisma.churchPaymentAccount.findUnique({
      where: { churchId },
    });

    let accountId = existing?.stripeAccountId ?? null;

    // Só exige perfil fiscal completo na 1ª criação da conta conectada —
    // retomar onboarding de conta já criada não depende disso.
    if (!accountId) {
      if (!isOwnerOnboardingMinimumComplete(church.fiscalProfile)) {
        throw new BadRequestException(
          'Complete o perfil da igreja (contato, cidade/UF e dados fiscais) antes de ativar os recebimentos.',
        );
      }

      const fiscal = church.fiscalProfile!;

      const account = await this.stripeConnect.createConnectedAccount({
        churchId,
        documentType: fiscal.documentType,
        documentNumber: fiscal.documentNumber,
        legalName: fiscal.legalName,
        responsibleName: fiscal.responsibleName,
        responsibleDocument: fiscal.responsibleDocument,
        addressLine: fiscal.addressLine,
        city: fiscal.city,
        state: fiscal.state,
        zipCode: fiscal.zipCode,
        contactEmail: fiscal.contactEmail,
        contactPhone: fiscal.contactPhone,
      });

      accountId = account.id;

      await this.prisma.churchPaymentAccount.upsert({
        where: { churchId },
        create: {
          churchId,
          stripeAccountId: accountId,
          onboardingStatus: ConnectOnboardingStatus.created,
        },
        update: {
          stripeAccountId: accountId,
          onboardingStatus: ConnectOnboardingStatus.created,
        },
      });
    }

    const url = await this.buildAccountLink(accountId);

    await this.prisma.churchPaymentAccount.update({
      where: { churchId },
      data: { onboardingStatus: ConnectOnboardingStatus.onboarding },
    });

    return { url };
  }

  async createAccountLink(churchId: string): Promise<{ url: string }> {
    this.stripeConnect.assertConfigured();

    const account = await this.prisma.churchPaymentAccount.findUnique({
      where: { churchId },
      select: { stripeAccountId: true },
    });

    if (!account?.stripeAccountId) {
      throw new BadRequestException(
        'Ative os recebimentos antes de retomar o cadastro.',
      );
    }

    const url = await this.buildAccountLink(account.stripeAccountId);

    return { url };
  }

  async syncConnectAccount(churchId: string): Promise<ConnectStatusResult> {
    this.stripeConnect.assertConfigured();

    const account = await this.prisma.churchPaymentAccount.findUnique({
      where: { churchId },
      select: { stripeAccountId: true },
    });

    if (!account?.stripeAccountId) {
      throw new BadRequestException(
        'Esta igreja ainda não iniciou o cadastro de recebimentos.',
      );
    }

    const stripeAccount = await this.stripeConnect.retrieveAccount(
      account.stripeAccountId,
    );
    const updated = await this.persistAccountState(churchId, stripeAccount);

    return this.toConnectStatusResult(updated);
  }

  async handleConnectWebhook(
    rawBody: Buffer,
    signature: string | undefined,
  ): Promise<{ received: true; duplicate?: true }> {
    if (!signature) {
      throw new BadRequestException('Assinatura Stripe ausente.');
    }

    let event: Stripe.Event;

    try {
      event = this.stripeConnect.constructWebhookEvent(rawBody, signature);
    } catch (error) {
      this.logger.warn(
        `Webhook Connect inválido: ${
          error instanceof Error ? error.message : 'erro desconhecido'
        }`,
      );
      throw new BadRequestException('Assinatura do webhook inválida.');
    }

    const alreadyProcessed = await this.prisma.connectWebhookEvent.findUnique({
      where: { id: event.id },
    });

    if (alreadyProcessed) {
      return { received: true, duplicate: true };
    }

    await this.dispatchConnectEvent(event);

    await this.prisma.connectWebhookEvent.create({ data: { id: event.id } });

    return { received: true };
  }

  private async dispatchConnectEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'account.updated': {
        const account = event.data.object as Stripe.Account;
        await this.syncFromWebhookAccount(account);
        break;
      }
      case 'capability.updated': {
        const capability = event.data.object as Stripe.Capability;
        const accountId =
          typeof capability.account === 'string'
            ? capability.account
            : capability.account?.id;

        if (accountId) {
          await this.syncFromAccountId(accountId);
        }
        break;
      }
      case 'payment_intent.succeeded':
      case 'payment_intent.processing':
      case 'payment_intent.payment_failed':
      case 'payment_intent.canceled': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        await this.syncDonationFromPaymentIntent(
          paymentIntent,
          event.type === 'payment_intent.payment_failed'
            ? GivingDonationStatus.failed
            : undefined,
        );
        break;
      }
      default:
        break;
    }
  }

  private async syncDonationFromPaymentIntent(
    paymentIntent: Stripe.PaymentIntent,
    statusOverride?: GivingDonationStatus,
  ): Promise<void> {
    const donationId = paymentIntent.metadata?.minhachurch_donation_id;
    const status =
      statusOverride ?? mapPaymentIntentStatus(paymentIntent.status);

    if (donationId) {
      const updated = await this.prisma.givingDonation.updateMany({
        where: { id: donationId },
        data: {
          status,
          stripePaymentIntentId: paymentIntent.id,
        },
      });

      if (updated.count > 0) {
        return;
      }
    }

    if (!paymentIntent.id) {
      return;
    }

    await this.prisma.givingDonation.updateMany({
      where: { stripePaymentIntentId: paymentIntent.id },
      data: { status },
    });
  }

  private async resolvePublicGivingContext(
    churchSlug: string,
    fundSlug: string,
  ): Promise<{
    church: { id: string; name: string; slug: string };
    fund: {
      id: string;
      name: string;
      slug: string;
      description: string | null;
    };
    stripeAccountId: string;
  }> {
    const church = await this.prisma.church.findUnique({
      where: { slug: churchSlug },
      select: {
        id: true,
        name: true,
        slug: true,
        paymentAccount: {
          select: {
            stripeAccountId: true,
            chargesEnabled: true,
          },
        },
      },
    });

    if (!church) {
      throw new NotFoundException('Página de contribuição não encontrada.');
    }

    if (
      !church.paymentAccount?.stripeAccountId ||
      !church.paymentAccount.chargesEnabled
    ) {
      throw new BadRequestException(
        'Esta igreja ainda não está recebendo contribuições online.',
      );
    }

    const fund = await this.prisma.givingFund.findFirst({
      where: {
        churchId: church.id,
        slug: fundSlug,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
      },
    });

    if (!fund) {
      throw new NotFoundException('Fundo de cobrança não encontrado.');
    }

    return {
      church: {
        id: church.id,
        name: church.name,
        slug: church.slug,
      },
      fund,
      stripeAccountId: church.paymentAccount.stripeAccountId,
    };
  }

  private async syncFromWebhookAccount(
    account: Stripe.Account,
  ): Promise<void> {
    const churchId = await this.resolveChurchIdForAccount(account.id);

    if (!churchId) {
      this.logger.warn(
        `account.updated sem igreja vinculada para conta ${account.id}.`,
      );
      return;
    }

    await this.persistAccountState(churchId, account);
  }

  private async syncFromAccountId(accountId: string): Promise<void> {
    const churchId = await this.resolveChurchIdForAccount(accountId);

    if (!churchId) {
      return;
    }

    const account = await this.stripeConnect.retrieveAccount(accountId);
    await this.persistAccountState(churchId, account);
  }

  private async resolveChurchIdForAccount(
    accountId: string,
  ): Promise<string | null> {
    const record = await this.prisma.churchPaymentAccount.findUnique({
      where: { stripeAccountId: accountId },
      select: { churchId: true },
    });

    return record?.churchId ?? null;
  }

  private async persistAccountState(
    churchId: string,
    account: Stripe.Account,
  ) {
    const state = this.stripeConnect.mapAccountToState(account);

    const updated = await this.prisma.churchPaymentAccount.update({
      where: { churchId },
      data: {
        onboardingStatus: state.onboardingStatus,
        chargesEnabled: state.chargesEnabled,
        payoutsEnabled: state.payoutsEnabled,
        detailsSubmitted: state.detailsSubmitted,
        pixStatus: state.capabilities.pix,
        cardStatus: state.capabilities.card,
        boletoStatus: state.capabilities.boleto,
        requirementsDue: state.requirementsDue as Prisma.InputJsonValue,
        disabledReason: state.disabledReason,
        lastSyncedAt: new Date(),
      },
    });

    await this.hydrateFiscalProfileFromStripe(churchId, account);

    return updated;
  }

  /**
   * Prefill do perfil fiscal com o subset que o Stripe Express ainda devolve.
   * Nunca sobrescreve campos já preenchidos pelo usuário. Se não houver perfil,
   * cria um rascunho só quando houver pelo menos `legalName` (CNPJ/CPF e
   * responsável ficam vazios para o owner completar no form).
   */
  private async hydrateFiscalProfileFromStripe(
    churchId: string,
    account: Stripe.Account,
  ): Promise<void> {
    const hints = this.stripeConnect.extractFiscalHints(account);

    if (!hints.legalName && !hints.contactEmail && !hints.contactPhone) {
      return;
    }

    const existing = await this.prisma.churchFiscalProfile.findUnique({
      where: { churchId },
    });

    if (!existing) {
      if (!hints.legalName) {
        return;
      }

      await this.prisma.churchFiscalProfile.create({
        data: {
          churchId,
          documentType: hints.documentType ?? ChurchDocumentType.cnpj,
          documentNumber: '',
          legalName: hints.legalName,
          responsibleName: '',
          contactEmail: hints.contactEmail,
          contactPhone: hints.contactPhone,
          addressLine: hints.addressLine,
          city: hints.city,
          state: hints.state?.toUpperCase() ?? null,
          zipCode: hints.zipCode,
        },
      });
      return;
    }

    const data: Prisma.ChurchFiscalProfileUpdateInput = {};

    if (!existing.legalName.trim() && hints.legalName) {
      data.legalName = hints.legalName;
    }
    if (!existing.contactEmail && hints.contactEmail) {
      data.contactEmail = hints.contactEmail;
    }
    if (!existing.contactPhone && hints.contactPhone) {
      data.contactPhone = hints.contactPhone;
    }
    if (!existing.addressLine && hints.addressLine) {
      data.addressLine = hints.addressLine;
    }
    if (!existing.city && hints.city) {
      data.city = hints.city;
    }
    if (!existing.state && hints.state) {
      data.state = hints.state.toUpperCase();
    }
    if (!existing.zipCode && hints.zipCode) {
      data.zipCode = hints.zipCode;
    }

    if (Object.keys(data).length === 0) {
      return;
    }

    await this.prisma.churchFiscalProfile.update({
      where: { churchId },
      data,
    });
  }

  private async buildAccountLink(accountId: string): Promise<string> {
    const appUrl = this.configService.getOrThrow<string>('appUrl');
    const link = await this.stripeConnect.createAccountLink(
      accountId,
      `${appUrl}${CONNECT_RETURN_PATH}`,
      `${appUrl}${CONNECT_REFRESH_PATH}`,
    );

    if (!link.url) {
      throw new BadRequestException(
        'Não foi possível abrir o cadastro de recebimentos. Tente novamente.',
      );
    }

    return link.url;
  }

  private normalizeAndValidateDocument(
    documentType: ChurchDocumentType,
    value: string,
  ): string {
    if (documentType === ChurchDocumentType.cnpj) {
      const digits = normalizeCnpj(value);

      if (!isValidCnpj(digits)) {
        throw new BadRequestException('CNPJ inválido.');
      }

      return digits;
    }

    const digits = normalizeCpf(value);

    if (!isValidCpf(digits)) {
      throw new BadRequestException('CPF inválido.');
    }

    return digits;
  }

  private toFiscalProfileResult(profile: {
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
    updatedAt: Date;
  }): FiscalProfileResult {
    return {
      documentType: profile.documentType,
      documentNumber: profile.documentNumber,
      legalName: profile.legalName,
      responsibleName: profile.responsibleName,
      responsibleDocument: profile.responsibleDocument,
      addressLine: profile.addressLine,
      city: profile.city,
      state: profile.state,
      zipCode: profile.zipCode,
      contactEmail: profile.contactEmail,
      contactPhone: profile.contactPhone,
      updatedAt: profile.updatedAt.toISOString(),
    };
  }

  private toConnectStatusResult(account: {
    stripeAccountId: string | null;
    onboardingStatus: ConnectOnboardingStatus;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
    pixStatus: ConnectCapabilityStatus;
    cardStatus: ConnectCapabilityStatus;
    boletoStatus: ConnectCapabilityStatus;
    requirementsDue: Prisma.JsonValue;
    disabledReason: string | null;
    lastSyncedAt: Date | null;
  }): ConnectStatusResult {
    return {
      hasAccount: Boolean(account.stripeAccountId),
      canReceivePayments: account.chargesEnabled,
      onboardingStatus: account.onboardingStatus,
      chargesEnabled: account.chargesEnabled,
      payoutsEnabled: account.payoutsEnabled,
      detailsSubmitted: account.detailsSubmitted,
      capabilities: {
        pix: account.pixStatus,
        card: account.cardStatus,
        boleto: account.boletoStatus,
      },
      requirementsDue: Array.isArray(account.requirementsDue)
        ? (account.requirementsDue as string[])
        : [],
      disabledReason: account.disabledReason,
      lastSyncedAt: account.lastSyncedAt
        ? account.lastSyncedAt.toISOString()
        : null,
    };
  }

  private toGivingFundResult(fund: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    isActive: boolean;
    sortOrder: number;
    createdAt: Date;
    updatedAt: Date;
    _count?: { donations: number };
  }): GivingFundResult {
    return {
      id: fund.id,
      name: fund.name,
      slug: fund.slug,
      description: fund.description,
      isActive: fund.isActive,
      canDelete: (fund._count?.donations ?? 0) === 0,
      sortOrder: fund.sortOrder,
      createdAt: fund.createdAt.toISOString(),
      updatedAt: fund.updatedAt.toISOString(),
    };
  }

  private async allocateFundSlug(
    churchId: string,
    name: string,
    excludeFundId?: string,
  ): Promise<string> {
    const base = slugifyFundName(name);
    let slug = base;
    let suffix = 0;

    while (true) {
      const clash = await this.prisma.givingFund.findFirst({
        where: {
          churchId,
          slug,
          ...(excludeFundId ? { id: { not: excludeFundId } } : {}),
        },
        select: { id: true },
      });

      if (!clash) {
        return slug;
      }

      suffix += 1;
      slug = `${base}-${suffix}`;
    }
  }
}

function mapPaymentIntentStatus(
  status: Stripe.PaymentIntent.Status,
): GivingDonationStatus {
  switch (status) {
    case 'succeeded':
      return GivingDonationStatus.succeeded;
    case 'processing':
      return GivingDonationStatus.processing;
    case 'canceled':
      return GivingDonationStatus.canceled;
    case 'requires_payment_method':
    case 'requires_confirmation':
    case 'requires_action':
    case 'requires_capture':
      return GivingDonationStatus.pending;
    default:
      return GivingDonationStatus.failed;
  }
}

function emptyToNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function slugifyFundName(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  return slug.length > 0 ? slug : 'fundo';
}
