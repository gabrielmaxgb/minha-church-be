import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ChurchDocumentType,
  ConnectCapabilityStatus,
  ConnectOnboardingStatus,
  FinanceEntryMethod,
  FinanceEntryType,
  EventTicketStatus,
  GivingDonationStatus,
  GivingFundAudience,
  GivingSubscriptionStatus,
  MemberStatus,
  Prisma,
} from '@prisma/client';
import type Stripe from 'stripe';

import { isValidCnpj, normalizeCnpj } from '../../common/utils/cnpj';
import { isValidCpf, normalizeCpf } from '../../common/utils/cpf';
import { SubscriptionPolicyService } from '../../common/services/subscription-policy.service';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UpsertFiscalProfileDto } from './dto/upsert-fiscal-profile.dto';
import {
  CreateGivingCheckoutDto,
  GIVING_MAX_AMOUNT_CENTS,
  GIVING_MIN_AMOUNT_CENTS,
} from './dto/create-giving-checkout.dto';
import { CreateMemberGivingCheckoutDto } from './dto/create-member-giving-checkout.dto';
import {
  CreateGivingFundDto,
  UpdateGivingFundDto,
} from './dto/giving-fund.dto';
import {
  CreateFinanceEntryDto,
  UpdateFinanceEntryDto,
} from './dto/finance-entry.dto';
import { isOwnerOnboardingMinimumComplete } from './fiscal-profile-completeness';
import {
  createGivingReceiptToken,
  verifyGivingReceiptToken,
} from './giving-receipt-token';
import { StripeConnectService } from './stripe-connect.service';
import type {
  ConnectPayoutsOverviewResult,
  ConnectPayoutResult,
  ConnectPayoutStatus,
  ConnectStatusResult,
  EventTicketPurchaseListResult,
  EventTicketPurchaseResult,
  FiscalProfileResult,
  GivingCheckoutResult,
  GivingDonationListResult,
  GivingDonationOutcome,
  GivingDonationReceiptResult,
  GivingDonationResult,
  GivingFundResult,
  GivingSubscriptionResult,
  ListEventTicketPurchasesOptions,
  ListGivingDonationsOptions,
  FinanceEntryListResult,
  FinanceEntryResult,
  FinanceEntriesSummaryResult,
  ListFinanceEntriesOptions,
  MemberGivingFundResult,
  PaymentsSummaryResult,
  PublicGivingFundResult,
} from './payments.types';
import { randomUUID } from 'crypto';

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
    private readonly subscriptionPolicy: SubscriptionPolicyService,
    private readonly notificationsService: NotificationsService,
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

  async getPaymentsSummary(churchId: string): Promise<PaymentsSummaryResult> {
    const connect = await this.getConnectStatus(churchId);
    const since = new Date();
    since.setDate(since.getDate() - 30);

    const [activeFunds, memberFunds, publicFunds, succeededCount, amountAgg] =
      await Promise.all([
        this.prisma.givingFund.count({
          where: { churchId, isActive: true },
        }),
        this.prisma.givingFund.count({
          where: {
            churchId,
            isActive: true,
            audience: GivingFundAudience.members,
          },
        }),
        this.prisma.givingFund.count({
          where: {
            churchId,
            isActive: true,
            audience: GivingFundAudience.public,
          },
        }),
        this.prisma.givingDonation.count({
          where: { churchId, status: GivingDonationStatus.succeeded },
        }),
        this.prisma.givingDonation.aggregate({
          where: {
            churchId,
            status: GivingDonationStatus.succeeded,
            createdAt: { gte: since },
          },
          _sum: { amountCents: true },
        }),
      ]);

    return {
      canReceivePayments: connect.canReceivePayments,
      onboardingStatus: connect.hasAccount
        ? connect.onboardingStatus
        : 'none',
      activeFundsCount: activeFunds,
      memberFundsCount: memberFunds,
      publicFundsCount: publicFunds,
      succeededDonationsCount: succeededCount,
      succeededAmountCentsLast30Days: amountAgg._sum.amountCents ?? 0,
    };
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

  async listMemberGivingFunds(
    churchId: string,
    userId: string,
  ): Promise<MemberGivingFundResult[]> {
    await this.requireActiveMember(churchId, userId);

    const funds = await this.prisma.givingFund.findMany({
      where: {
        churchId,
        isActive: true,
        audience: GivingFundAudience.members,
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        description: true,
        allowPix: true,
        allowCard: true,
        allowBoleto: true,
      },
    });

    return funds.map((fund) => ({
      id: fund.id,
      name: fund.name,
      description: fund.description,
      paymentMethods: {
        pix: fund.allowPix,
        card: fund.allowCard,
        boleto: fund.allowBoleto,
      },
      currency: 'brl' as const,
      minAmountCents: GIVING_MIN_AMOUNT_CENTS,
      maxAmountCents: GIVING_MAX_AMOUNT_CENTS,
    }));
  }

  async createGivingFund(
    churchId: string,
    dto: CreateGivingFundDto,
  ): Promise<GivingFundResult> {
    const church = await this.prisma.church.findUnique({
      where: { id: churchId },
      select: {
        id: true,
        fiscalProfile: true,
        paymentAccount: {
          select: {
            pixStatus: true,
            cardStatus: true,
            boletoStatus: true,
          },
        },
      },
    });

    if (!church) {
      throw new NotFoundException('Igreja não encontrada.');
    }

    if (!isOwnerOnboardingMinimumComplete(church.fiscalProfile)) {
      throw new BadRequestException(
        'Complete o perfil da igreja (contato, cidade/UF e dados fiscais) antes de criar fundos de contribuição.',
      );
    }

    const paymentMethods = this.normalizeFundPaymentMethods({
      allowPix: dto.allowPix,
      allowCard: dto.allowCard,
      allowBoleto: dto.allowBoleto,
      account: church.paymentAccount,
    });

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
        audience: dto.audience,
        allowPix: paymentMethods.pix,
        allowCard: paymentMethods.card,
        allowBoleto: paymentMethods.boleto,
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

    if (
      dto.allowPix !== undefined ||
      dto.allowCard !== undefined ||
      dto.allowBoleto !== undefined
    ) {
      const account = await this.prisma.churchPaymentAccount.findUnique({
        where: { churchId },
        select: {
          pixStatus: true,
          cardStatus: true,
          boletoStatus: true,
        },
      });

      const paymentMethods = this.normalizeFundPaymentMethods({
        allowPix: dto.allowPix ?? existing.allowPix,
        allowCard: dto.allowCard ?? existing.allowCard,
        allowBoleto: dto.allowBoleto ?? existing.allowBoleto,
        account,
      });

      data.allowPix = paymentMethods.pix;
      data.allowCard = paymentMethods.card;
      data.allowBoleto = paymentMethods.boleto;
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
    options?: ListGivingDonationsOptions,
  ): Promise<GivingDonationListResult> {
    const page = Math.max(options?.page ?? 1, 1);
    const limit = Math.min(Math.max(options?.limit ?? 50, 1), 100);
    const where = this.buildGivingDonationsWhere(churchId, options);

    const [total, donations] = await this.prisma.$transaction([
      this.prisma.givingDonation.count({ where }),
      this.prisma.givingDonation.findMany({
        where,
        include: {
          fund: { select: { id: true, name: true } },
          donorMember: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      items: donations.map((donation) => this.toGivingDonationResult(donation)),
      page,
      limit,
      total,
    };
  }

  async exportGivingDonationsCsv(
    churchId: string,
    options?: ListGivingDonationsOptions,
  ): Promise<string> {
    const where = this.buildGivingDonationsWhere(churchId, options);
    const donations = await this.prisma.givingDonation.findMany({
      where,
      include: {
        fund: { select: { id: true, name: true } },
        donorMember: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });

    const header = [
      'Data',
      'Fundo',
      'Valor',
      'Moeda',
      'Status',
      'Doador',
      'E-mail',
      'ID do membro',
    ];
    const rows = donations.map((donation) =>
      [
        formatCsvDateTime(donation.createdAt),
        donation.fund.name,
        formatCsvCurrency(donation.amountCents),
        donation.currency.toUpperCase(),
        formatGivingDonationStatusLabel(donation.status),
        donation.donorMember?.name ?? donation.payerName ?? '',
        donation.payerEmail ?? '',
        donation.donorMemberId ?? '',
      ]
        .map(escapeCsvCell)
        .join(','),
    );

    return `\uFEFF${header.join(',')}\n${rows.join('\n')}\n`;
  }

  async listFinanceEntries(
    churchId: string,
    options?: ListFinanceEntriesOptions,
  ): Promise<FinanceEntryListResult> {
    const page = Math.max(options?.page ?? 1, 1);
    const limit = Math.min(Math.max(options?.limit ?? 50, 1), 100);
    const where = this.buildFinanceEntriesWhere(churchId, options);

    const [total, entries] = await this.prisma.$transaction([
      this.prisma.financeEntry.count({ where }),
      this.prisma.financeEntry.findMany({
        where,
        include: {
          fund: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
        },
        orderBy: [{ occurredOn: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      items: entries.map((entry) => this.toFinanceEntryResult(entry)),
      page,
      limit,
      total,
    };
  }

  async createFinanceEntry(
    churchId: string,
    userId: string,
    dto: CreateFinanceEntryDto,
  ): Promise<FinanceEntryResult> {
    await this.assertFinanceEntryFund(churchId, dto.fundId);

    const entry = await this.prisma.financeEntry.create({
      data: {
        churchId,
        type: dto.type,
        amountCents: dto.amountCents,
        occurredOn: this.parseFinanceDate(dto.occurredOn),
        category: dto.category.trim(),
        fundId: dto.fundId ?? null,
        method: dto.method ?? FinanceEntryMethod.other,
        note: emptyToNull(dto.note),
        createdByUserId: userId,
      },
      include: {
        fund: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });

    return this.toFinanceEntryResult(entry);
  }

  async updateFinanceEntry(
    churchId: string,
    entryId: string,
    dto: UpdateFinanceEntryDto,
  ): Promise<FinanceEntryResult> {
    const existing = await this.prisma.financeEntry.findFirst({
      where: { id: entryId, churchId },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException('Lançamento não encontrado.');
    }

    if (dto.fundId !== undefined && dto.fundId !== null) {
      await this.assertFinanceEntryFund(churchId, dto.fundId);
    }

    const entry = await this.prisma.financeEntry.update({
      where: { id: entryId },
      data: {
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.amountCents !== undefined
          ? { amountCents: dto.amountCents }
          : {}),
        ...(dto.occurredOn !== undefined
          ? { occurredOn: this.parseFinanceDate(dto.occurredOn) }
          : {}),
        ...(dto.category !== undefined
          ? { category: dto.category.trim() }
          : {}),
        ...(dto.fundId !== undefined ? { fundId: dto.fundId } : {}),
        ...(dto.method !== undefined ? { method: dto.method } : {}),
        ...(dto.note !== undefined ? { note: emptyToNull(dto.note ?? undefined) } : {}),
      },
      include: {
        fund: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });

    return this.toFinanceEntryResult(entry);
  }

  async deleteFinanceEntry(
    churchId: string,
    entryId: string,
  ): Promise<{ ok: true }> {
    const existing = await this.prisma.financeEntry.findFirst({
      where: { id: entryId, churchId },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException('Lançamento não encontrado.');
    }

    await this.prisma.financeEntry.delete({ where: { id: entryId } });
    return { ok: true };
  }

  async getFinanceEntriesSummary(
    churchId: string,
    options?: { from?: string; to?: string },
  ): Promise<FinanceEntriesSummaryResult> {
    const entryWhere = this.buildFinanceEntriesWhere(churchId, options);
    const donationWhere = this.buildSucceededDonationsDateWhere(
      churchId,
      options,
    );
    const ticketWhere = this.buildSucceededEventTicketsDateWhere(
      churchId,
      options,
    );

    const [incomeAgg, expenseAgg, donationAgg, ticketAgg] = await Promise.all([
      this.prisma.financeEntry.aggregate({
        where: { ...entryWhere, type: FinanceEntryType.income },
        _sum: { amountCents: true },
      }),
      this.prisma.financeEntry.aggregate({
        where: { ...entryWhere, type: FinanceEntryType.expense },
        _sum: { amountCents: true },
      }),
      this.prisma.givingDonation.aggregate({
        where: donationWhere,
        _sum: { amountCents: true },
      }),
      this.prisma.eventTicketPurchase.aggregate({
        where: ticketWhere,
        _sum: { amountCents: true },
      }),
    ]);

    const incomeCents = incomeAgg._sum.amountCents ?? 0;
    const expenseCents = expenseAgg._sum.amountCents ?? 0;
    const onlineDonationCents = donationAgg._sum.amountCents ?? 0;
    const eventTicketCents = ticketAgg._sum.amountCents ?? 0;

    return {
      incomeCents,
      expenseCents,
      balanceCents:
        incomeCents + onlineDonationCents + eventTicketCents - expenseCents,
      onlineDonationCents,
      eventTicketCents,
    };
  }

  async listEventTicketPurchases(
    churchId: string,
    options?: ListEventTicketPurchasesOptions,
  ): Promise<EventTicketPurchaseListResult> {
    const page = Math.max(options?.page ?? 1, 1);
    const limit = Math.min(Math.max(options?.limit ?? 50, 1), 100);
    const where = this.buildEventTicketPurchasesWhere(churchId, options);

    const [total, purchases] = await this.prisma.$transaction([
      this.prisma.eventTicketPurchase.count({ where }),
      this.prisma.eventTicketPurchase.findMany({
        where,
        include: {
          event: { select: { id: true, name: true } },
          member: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      items: purchases.map((purchase) =>
        this.toEventTicketPurchaseResult(purchase),
      ),
      page,
      limit,
      total,
    };
  }

  async exportEventTicketPurchasesCsv(
    churchId: string,
    options?: ListEventTicketPurchasesOptions,
  ): Promise<string> {
    const where = this.buildEventTicketPurchasesWhere(churchId, options);
    const purchases = await this.prisma.eventTicketPurchase.findMany({
      where,
      include: {
        event: { select: { id: true, name: true } },
        member: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });

    const header = [
      'Data',
      'Evento',
      'Valor',
      'Moeda',
      'Status',
      'Participante',
      'E-mail',
      'ID do membro',
    ];
    const rows = purchases.map((purchase) =>
      [
        formatCsvDateTime(purchase.createdAt),
        purchase.event.name,
        formatCsvCurrency(purchase.amountCents),
        purchase.currency.toUpperCase(),
        formatEventTicketStatusLabel(purchase.status),
        purchase.member?.name ?? purchase.buyerName ?? '',
        purchase.buyerEmail ?? '',
        purchase.memberId ?? '',
      ]
        .map(escapeCsvCell)
        .join(','),
    );

    return `\uFEFF${header.join(',')}\n${rows.join('\n')}\n`;
  }

  async exportFinanceEntriesCsv(
    churchId: string,
    options?: ListFinanceEntriesOptions,
  ): Promise<string> {
    const entryWhere = this.buildFinanceEntriesWhere(churchId, options);
    const donationWhere = this.buildSucceededDonationsDateWhere(
      churchId,
      options,
    );
    const ticketWhere = this.buildSucceededEventTicketsDateWhere(
      churchId,
      options,
    );

    const [entries, donations, tickets] = await Promise.all([
      this.prisma.financeEntry.findMany({
        where: entryWhere,
        include: { fund: { select: { name: true } } },
        orderBy: [{ occurredOn: 'desc' }, { createdAt: 'desc' }],
        take: 5000,
      }),
      this.prisma.givingDonation.findMany({
        where: donationWhere,
        include: {
          fund: { select: { name: true } },
          donorMember: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 5000,
      }),
      this.prisma.eventTicketPurchase.findMany({
        where: ticketWhere,
        include: {
          event: { select: { name: true } },
          member: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 5000,
      }),
    ]);

    type ExportRow = {
      source: 'manual' | 'online' | 'event_ticket';
      type: FinanceEntryType | 'income';
      date: Date;
      category: string;
      fund: string;
      amountCents: number;
      currency: string;
      method: FinanceEntryMethod | 'online';
      note: string;
    };

    const rows: ExportRow[] = [
      ...entries.map((entry) => ({
        source: 'manual' as const,
        type: entry.type,
        date: entry.occurredOn,
        category: entry.category,
        fund: entry.fund?.name ?? '',
        amountCents: entry.amountCents,
        currency: entry.currency,
        method: entry.method,
        note: entry.note ?? '',
      })),
      ...donations.map((donation) => ({
        source: 'online' as const,
        type: 'income' as const,
        date: donation.createdAt,
        category: 'Contribuição online',
        fund: donation.fund.name,
        amountCents: donation.amountCents,
        currency: donation.currency,
        method: 'online' as const,
        note: donation.donorMember?.name ?? donation.payerName ?? '',
      })),
      ...tickets.map((ticket) => ({
        source: 'event_ticket' as const,
        type: 'income' as const,
        date: ticket.createdAt,
        category: `Inscrição — ${ticket.event.name}`,
        fund: ticket.event.name,
        amountCents: ticket.amountCents,
        currency: ticket.currency,
        method: 'online' as const,
        note: ticket.member?.name ?? ticket.buyerName ?? '',
      })),
    ];

    rows.sort((a, b) => b.date.getTime() - a.date.getTime());

    const header = [
      'Origem',
      'Tipo',
      'Data',
      'Categoria',
      'Fundo',
      'Valor',
      'Moeda',
      'Forma de pagamento',
      'Observação',
    ];
    const csvRows = rows.map((row) =>
      [
        formatFinanceEntrySourceLabel(row.source),
        formatFinanceEntryTypeLabel(row.type),
        row.source === 'manual'
          ? formatCsvDate(row.date)
          : formatCsvDateTime(row.date),
        row.category,
        row.fund,
        formatCsvCurrency(row.amountCents),
        row.currency.toUpperCase(),
        formatFinanceEntryMethodLabel(row.method),
        row.note,
      ]
        .map(escapeCsvCell)
        .join(','),
    );

    return `\uFEFF${header.join(',')}\n${csvRows.join('\n')}\n`;
  }

  async refundGivingDonation(
    churchId: string,
    donationId: string,
  ): Promise<GivingDonationResult> {
    this.stripeConnect.assertConfigured();

    const donation = await this.prisma.givingDonation.findFirst({
      where: { id: donationId, churchId },
      include: {
        fund: { select: { id: true, name: true } },
        donorMember: { select: { id: true, name: true } },
      },
    });

    if (!donation) {
      throw new NotFoundException('Contribuição não encontrada.');
    }

    if (donation.status === GivingDonationStatus.refunded) {
      return this.toGivingDonationResult(donation);
    }

    if (donation.status !== GivingDonationStatus.succeeded) {
      throw new BadRequestException(
        'Só é possível estornar contribuições confirmadas.',
      );
    }

    if (!donation.stripePaymentIntentId) {
      throw new BadRequestException(
        'Esta contribuição não possui cobrança Stripe para estornar.',
      );
    }

    const account = await this.prisma.churchPaymentAccount.findUnique({
      where: { churchId },
      select: { stripeAccountId: true },
    });

    if (!account?.stripeAccountId) {
      throw new BadRequestException(
        'Conta de recebimentos não encontrada para esta igreja.',
      );
    }

    try {
      await this.stripeConnect.createRefund({
        stripeAccountId: account.stripeAccountId,
        paymentIntentId: donation.stripePaymentIntentId,
        metadata: {
          minhachurch_donation_id: donation.id,
          minhachurch_church_id: churchId,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Falha ao estornar doação ${donation.id}: ${
          error instanceof Error ? error.message : 'erro desconhecido'
        }`,
      );
      throw new BadRequestException(
        error instanceof Error
          ? error.message
          : 'Não foi possível estornar esta contribuição.',
      );
    }

    const updated = await this.prisma.givingDonation.update({
      where: { id: donation.id },
      data: { status: GivingDonationStatus.refunded },
      include: {
        fund: { select: { id: true, name: true } },
        donorMember: { select: { id: true, name: true } },
      },
    });

    this.notificationsService.schedule(
      this.notificationsService.emitGivingDonationRefunded({
        churchId,
        donationId: updated.id,
        donorMemberId: updated.donorMemberId,
        amountCents: updated.amountCents,
        currency: updated.currency,
        fundName: updated.fund.name,
        resetRead: true,
      }),
      `giving_donation_refunded:${updated.id}`,
    );

    return this.toGivingDonationResult(updated);
  }

  async refundEventTicketPurchase(
    churchId: string,
    ticketId: string,
  ): Promise<EventTicketPurchaseResult> {
    this.stripeConnect.assertConfigured();

    const purchase = await this.prisma.eventTicketPurchase.findFirst({
      where: { id: ticketId, churchId },
      include: {
        event: { select: { id: true, name: true } },
        member: { select: { id: true, name: true } },
      },
    });

    if (!purchase) {
      throw new NotFoundException('Inscrição paga não encontrada.');
    }

    if (purchase.status === EventTicketStatus.refunded) {
      return this.toEventTicketPurchaseResult(purchase);
    }

    if (purchase.status !== EventTicketStatus.succeeded) {
      throw new BadRequestException(
        'Só é possível estornar inscrições confirmadas.',
      );
    }

    if (!purchase.stripePaymentIntentId) {
      throw new BadRequestException(
        'Esta inscrição não possui cobrança Stripe para estornar.',
      );
    }

    const account = await this.prisma.churchPaymentAccount.findUnique({
      where: { churchId },
      select: { stripeAccountId: true },
    });

    if (!account?.stripeAccountId) {
      throw new BadRequestException(
        'Conta de recebimentos não encontrada para esta igreja.',
      );
    }

    try {
      await this.stripeConnect.createRefund({
        stripeAccountId: account.stripeAccountId,
        paymentIntentId: purchase.stripePaymentIntentId,
        metadata: {
          minhachurch_ticket_id: purchase.id,
          minhachurch_event_id: purchase.eventId,
          minhachurch_church_id: churchId,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Falha ao estornar inscrição ${purchase.id}: ${
          error instanceof Error ? error.message : 'erro desconhecido'
        }`,
      );
      throw new BadRequestException(
        error instanceof Error
          ? error.message
          : 'Não foi possível estornar esta inscrição.',
      );
    }

    const updated = await this.prisma.eventTicketPurchase.update({
      where: { id: purchase.id },
      data: { status: EventTicketStatus.refunded },
      include: {
        event: { select: { id: true, name: true } },
        member: { select: { id: true, name: true } },
      },
    });

    return this.toEventTicketPurchaseResult(updated);
  }

  private buildEventTicketPurchasesWhere(
    churchId: string,
    options?: ListEventTicketPurchasesOptions,
  ): Prisma.EventTicketPurchaseWhereInput {
    const where: Prisma.EventTicketPurchaseWhereInput = { churchId };

    if (options?.eventId) {
      where.eventId = options.eventId;
    }

    if (options?.memberId) {
      where.memberId = options.memberId;
    }

    if (options?.status) {
      const status = options.status as EventTicketStatus;
      if (Object.values(EventTicketStatus).includes(status)) {
        where.status = status;
      }
    }

    const createdAt: Prisma.DateTimeFilter = {};
    if (options?.from) {
      const from = new Date(options.from);
      if (!Number.isNaN(from.getTime())) {
        createdAt.gte = from;
      }
    }
    if (options?.to) {
      const to = new Date(options.to);
      if (!Number.isNaN(to.getTime())) {
        createdAt.lte = to;
      }
    }
    if (Object.keys(createdAt).length > 0) {
      where.createdAt = createdAt;
    }

    return where;
  }

  private buildSucceededEventTicketsDateWhere(
    churchId: string,
    options?: { from?: string; to?: string },
  ): Prisma.EventTicketPurchaseWhereInput {
    const where: Prisma.EventTicketPurchaseWhereInput = {
      churchId,
      status: EventTicketStatus.succeeded,
    };

    const createdAt: Prisma.DateTimeFilter = {};
    if (options?.from) {
      const from = new Date(options.from);
      if (!Number.isNaN(from.getTime())) {
        createdAt.gte = from;
      }
    }
    if (options?.to) {
      const to = new Date(options.to);
      if (!Number.isNaN(to.getTime())) {
        createdAt.lte = to;
      }
    }
    if (Object.keys(createdAt).length > 0) {
      where.createdAt = createdAt;
    }

    return where;
  }

  private toEventTicketPurchaseResult(purchase: {
    id: string;
    amountCents: number;
    currency: string;
    status: string;
    buyerName: string | null;
    buyerEmail: string | null;
    createdAt: Date;
    event: { id: string; name: string };
    member: { id: string; name: string } | null;
  }): EventTicketPurchaseResult {
    return {
      id: purchase.id,
      eventId: purchase.event.id,
      eventName: purchase.event.name,
      amountCents: purchase.amountCents,
      currency: purchase.currency,
      status: purchase.status,
      buyerName: purchase.buyerName,
      buyerEmail: purchase.buyerEmail,
      memberId: purchase.member?.id ?? null,
      memberName: purchase.member?.name ?? null,
      createdAt: purchase.createdAt.toISOString(),
    };
  }

  private buildGivingDonationsWhere(
    churchId: string,
    options?: ListGivingDonationsOptions,
  ): Prisma.GivingDonationWhereInput {
    const where: Prisma.GivingDonationWhereInput = { churchId };

    if (options?.fundId) {
      where.fundId = options.fundId;
    }

    if (options?.memberId) {
      where.donorMemberId = options.memberId;
    }

    if (options?.status) {
      const status = options.status as GivingDonationStatus;
      if (Object.values(GivingDonationStatus).includes(status)) {
        where.status = status;
      }
    }

    const createdAt: Prisma.DateTimeFilter = {};
    if (options?.from) {
      const from = new Date(options.from);
      if (!Number.isNaN(from.getTime())) {
        createdAt.gte = from;
      }
    }
    if (options?.to) {
      const to = new Date(options.to);
      if (!Number.isNaN(to.getTime())) {
        createdAt.lte = to;
      }
    }
    if (Object.keys(createdAt).length > 0) {
      where.createdAt = createdAt;
    }

    return where;
  }

  private buildFinanceEntriesWhere(
    churchId: string,
    options?: ListFinanceEntriesOptions | { from?: string; to?: string },
  ): Prisma.FinanceEntryWhereInput {
    const where: Prisma.FinanceEntryWhereInput = { churchId };

    if (options && 'type' in options && options.type) {
      const type = options.type as FinanceEntryType;
      if (Object.values(FinanceEntryType).includes(type)) {
        where.type = type;
      }
    }

    const occurredOn: Prisma.DateTimeFilter = {};
    if (options?.from) {
      const from = this.parseFinanceDate(options.from);
      occurredOn.gte = from;
    }
    if (options?.to) {
      const to = this.parseFinanceDate(options.to);
      occurredOn.lte = to;
    }
    if (Object.keys(occurredOn).length > 0) {
      where.occurredOn = occurredOn;
    }

    return where;
  }

  private buildSucceededDonationsDateWhere(
    churchId: string,
    options?: { from?: string; to?: string },
  ): Prisma.GivingDonationWhereInput {
    const where: Prisma.GivingDonationWhereInput = {
      churchId,
      status: GivingDonationStatus.succeeded,
    };

    const createdAt: Prisma.DateTimeFilter = {};
    if (options?.from) {
      const from = new Date(options.from);
      if (!Number.isNaN(from.getTime())) {
        createdAt.gte = from;
      }
    }
    if (options?.to) {
      const to = new Date(options.to);
      if (!Number.isNaN(to.getTime())) {
        createdAt.lte = to;
      }
    }
    if (Object.keys(createdAt).length > 0) {
      where.createdAt = createdAt;
    }

    return where;
  }

  private parseFinanceDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('Data inválida.');
    }
    return date;
  }

  private async assertFinanceEntryFund(
    churchId: string,
    fundId?: string,
  ): Promise<void> {
    if (!fundId) {
      return;
    }

    const fund = await this.prisma.givingFund.findFirst({
      where: { id: fundId, churchId },
      select: { id: true },
    });

    if (!fund) {
      throw new BadRequestException('Fundo não encontrado nesta igreja.');
    }
  }

  private toFinanceEntryResult(entry: {
    id: string;
    type: FinanceEntryType;
    amountCents: number;
    currency: string;
    occurredOn: Date;
    category: string;
    fundId: string | null;
    method: FinanceEntryMethod;
    note: string | null;
    createdByUserId: string | null;
    createdAt: Date;
    updatedAt: Date;
    fund: { id: string; name: string } | null;
    createdBy: { id: string; name: string } | null;
  }): FinanceEntryResult {
    return {
      id: entry.id,
      type: entry.type,
      amountCents: entry.amountCents,
      currency: entry.currency,
      occurredOn: entry.occurredOn.toISOString().slice(0, 10),
      category: entry.category,
      fundId: entry.fundId,
      fundName: entry.fund?.name ?? null,
      method: entry.method,
      note: entry.note,
      createdByUserId: entry.createdByUserId,
      createdByUserName: entry.createdBy?.name ?? null,
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
    };
  }

  /**
   * Histórico do próprio membro: doações vinculadas à ficha pastoral
   * e, complementarmente, doações públicas com o mesmo e-mail da conta.
   */
  async listMyGivingDonations(
    churchId: string,
    userId: string,
    options?: { limit?: number },
  ): Promise<GivingDonationResult[]> {
    const limit = Math.min(Math.max(options?.limit ?? 50, 1), 100);

    const member = await this.prisma.member.findFirst({
      where: { churchId, userId, deletedAt: null },
      select: {
        id: true,
        email: true,
        user: { select: { email: true } },
      },
    });

    if (!member) {
      return [];
    }

    const emails = Array.from(
      new Set(
        [member.user?.email, member.email]
          .map((value) => value?.trim().toLowerCase())
          .filter((value): value is string => Boolean(value)),
      ),
    );

    const donations = await this.prisma.givingDonation.findMany({
      where: {
        churchId,
        OR: [
          { donorMemberId: member.id },
          ...emails.map((email) => ({
            payerEmail: { equals: email, mode: 'insensitive' as const },
          })),
        ],
      },
      include: {
        fund: { select: { id: true, name: true } },
        donorMember: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return donations.map((donation) => this.toGivingDonationResult(donation));
  }

  private toGivingDonationResult(donation: {
    id: string;
    amountCents: number;
    currency: string;
    status: string;
    payerName: string | null;
    payerEmail: string | null;
    createdAt: Date;
    fund: { id: string; name: string };
    donorMember: { id: string; name: string } | null;
  }): GivingDonationResult {
    return {
      id: donation.id,
      fundId: donation.fund.id,
      fundName: donation.fund.name,
      amountCents: donation.amountCents,
      currency: donation.currency,
      status: donation.status,
      payerName: donation.payerName,
      payerEmail: donation.payerEmail,
      donorMemberId: donation.donorMember?.id ?? null,
      donorMemberName: donation.donorMember?.name ?? null,
      createdAt: donation.createdAt.toISOString(),
    };
  }

  /**
   * Recibo pós-checkout: sincroniza com o Stripe quando há PI e devolve
   * outcome estável para a UI (sem confiar em redirect_status).
   * Exige receiptToken emitido no checkout (não basta conhecer o donationId).
   */
  async getGivingDonationReceipt(
    donationId: string,
    receiptToken: string | undefined,
  ): Promise<GivingDonationReceiptResult> {
    const secret = this.configService.getOrThrow<string>('jwt.secret');
    if (!verifyGivingReceiptToken(donationId, receiptToken, secret)) {
      throw new NotFoundException('Contribuição não encontrada.');
    }

    const donation = await this.prisma.givingDonation.findFirst({
      where: { id: donationId },
      include: {
        fund: { select: { name: true } },
        church: {
          select: {
            paymentAccount: {
              select: { stripeAccountId: true },
            },
          },
        },
      },
    });

    if (!donation) {
      throw new NotFoundException('Contribuição não encontrada.');
    }

    let status = donation.status;
    const stripeAccountId = donation.church.paymentAccount?.stripeAccountId;

    if (donation.stripePaymentIntentId && stripeAccountId) {
      try {
        const paymentIntent = await this.stripeConnect.retrievePaymentIntent(
          donation.stripePaymentIntentId,
          stripeAccountId,
        );
        await this.syncDonationFromPaymentIntent(paymentIntent);
        status = resolveDonationStatusFromPaymentIntent(paymentIntent);
      } catch (error) {
        this.logger.warn(
          `Falha ao sincronizar doação ${donation.id} com Stripe: ${
            error instanceof Error ? error.message : 'erro desconhecido'
          }`,
        );
      }
    }

    return {
      donationId: donation.id,
      status,
      outcome: mapDonationOutcome(status),
      amountCents: donation.amountCents,
      currency: donation.currency,
      fundName: donation.fund.name,
    };
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
      paymentMethods: {
        pix: context.fund.allowPix,
        card: context.fund.allowCard,
        boleto: context.fund.allowBoleto,
      },
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

    const checkoutParams = {
      churchId: context.church.id,
      churchName: context.church.name,
      fundId: context.fund.id,
      fundName: context.fund.name,
      fundSlug: context.fund.slug,
      allowPix: context.fund.allowPix,
      allowCard: context.fund.allowCard,
      allowBoleto: context.fund.allowBoleto,
      stripeAccountId: context.stripeAccountId,
      accountCapabilities: context.accountCapabilities,
      publishableKey,
      amountCents: dto.amountCents,
      payerName,
      payerEmail,
      donorMemberId: null as string | null,
      metadataExtra: {} as Record<string, string>,
    };

    if (dto.recurring) {
      return this.createCheckoutSubscription(checkoutParams);
    }

    return this.createCheckoutPaymentIntent(checkoutParams);
  }

  async createMemberGivingCheckout(
    churchId: string,
    fundId: string,
    userId: string,
    dto: CreateMemberGivingCheckoutDto,
  ): Promise<GivingCheckoutResult> {
    this.stripeConnect.assertConfigured();

    const publishableKey = this.stripeConnect.getPublishableKey();
    if (!publishableKey) {
      throw new BadRequestException(
        'Chave pública do Stripe não configurada no servidor.',
      );
    }

    const member = await this.requireActiveMember(churchId, userId);
    const context = await this.resolveMemberGivingContext(churchId, fundId);

    const payerEmail =
      emptyToNull(member.email ?? undefined)?.toLowerCase() ??
      emptyToNull(member.userEmail ?? undefined)?.toLowerCase() ??
      null;

    const checkoutParams = {
      churchId: context.church.id,
      churchName: context.church.name,
      fundId: context.fund.id,
      fundName: context.fund.name,
      fundSlug: context.fund.slug,
      allowPix: context.fund.allowPix,
      allowCard: context.fund.allowCard,
      allowBoleto: context.fund.allowBoleto,
      stripeAccountId: context.stripeAccountId,
      accountCapabilities: context.accountCapabilities,
      publishableKey,
      amountCents: dto.amountCents,
      payerName: member.name,
      payerEmail,
      donorMemberId: member.id as string | null,
      metadataExtra: {
        minhachurch_member_id: member.id,
      } as Record<string, string>,
    };

    if (dto.recurring) {
      return this.createCheckoutSubscription(checkoutParams);
    }

    return this.createCheckoutPaymentIntent(checkoutParams);
  }

  private async createCheckoutPaymentIntent(params: {
    churchId: string;
    churchName: string;
    fundId: string;
    fundName: string;
    fundSlug: string;
    allowPix: boolean;
    allowCard: boolean;
    allowBoleto: boolean;
    stripeAccountId: string;
    accountCapabilities: {
      pixStatus: ConnectCapabilityStatus;
      cardStatus: ConnectCapabilityStatus;
      boletoStatus: ConnectCapabilityStatus;
    };
    publishableKey: string;
    amountCents: number;
    payerName: string | null;
    payerEmail: string | null;
    donorMemberId: string | null;
    metadataExtra: Record<string, string>;
  }): Promise<GivingCheckoutResult> {
    const allowedPaymentMethodTypes = this.resolveCheckoutPaymentMethodTypes({
      allowPix: params.allowPix,
      allowCard: params.allowCard,
      allowBoleto: params.allowBoleto,
      account: params.accountCapabilities,
    });

    if (allowedPaymentMethodTypes.length === 0) {
      throw new BadRequestException(
        'Este fundo não tem meios de pagamento disponíveis no momento.',
      );
    }

    const donation = await this.prisma.givingDonation.create({
      data: {
        churchId: params.churchId,
        fundId: params.fundId,
        donorMemberId: params.donorMemberId,
        amountCents: params.amountCents,
        currency: 'brl',
        status: GivingDonationStatus.pending,
        payerName: params.payerName,
        payerEmail: params.payerEmail,
      },
    });

    const feeBps =
      this.configService.get<number>('payments.platformFeeBps') ?? 0;
    const applicationFeeAmount =
      feeBps > 0 ? Math.floor((params.amountCents * feeBps) / 10_000) : 0;

    try {
      const paymentIntent = await this.stripeConnect.createPaymentIntent({
        stripeAccountId: params.stripeAccountId,
        amountCents: params.amountCents,
        applicationFeeAmount,
        receiptEmail: params.payerEmail ?? undefined,
        description: `${params.fundName} — ${params.churchName}`,
        allowedPaymentMethodTypes,
        idempotencyKey: `giving_pi_${donation.id}`,
        metadata: {
          minhachurch_donation_id: donation.id,
          minhachurch_church_id: params.churchId,
          minhachurch_fund_id: params.fundId,
          minhachurch_fund_slug: params.fundSlug,
          ...params.metadataExtra,
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
        receiptToken: this.issueGivingReceiptToken(donation.id),
        subscriptionId: null,
        mode: 'payment',
        clientSecret: paymentIntent.client_secret,
        stripeAccountId: params.stripeAccountId,
        publishableKey: params.publishableKey,
        amountCents: params.amountCents,
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

  private async createCheckoutSubscription(params: {
    churchId: string;
    churchName: string;
    fundId: string;
    fundName: string;
    fundSlug: string;
    allowPix: boolean;
    allowCard: boolean;
    allowBoleto: boolean;
    stripeAccountId: string;
    accountCapabilities: {
      pixStatus: ConnectCapabilityStatus;
      cardStatus: ConnectCapabilityStatus;
      boletoStatus: ConnectCapabilityStatus;
    };
    publishableKey: string;
    amountCents: number;
    payerName: string | null;
    payerEmail: string | null;
    donorMemberId: string | null;
    metadataExtra: Record<string, string>;
  }): Promise<GivingCheckoutResult> {
    if (
      !params.allowCard ||
      params.accountCapabilities.cardStatus !== ConnectCapabilityStatus.active
    ) {
      throw new BadRequestException(
        'Contribuição mensal exige cartão ativo neste fundo.',
      );
    }

    const feeBps =
      this.configService.get<number>('payments.platformFeeBps') ?? 0;
    const applicationFeePercent = feeBps > 0 ? feeBps / 100 : undefined;

    const customer = await this.stripeConnect.createCustomer({
      stripeAccountId: params.stripeAccountId,
      email: params.payerEmail,
      name: params.payerName,
      metadata: {
        minhachurch_church_id: params.churchId,
        ...params.metadataExtra,
      },
    });

    // Placeholder local — stripeSubscriptionId atualizado após create.
    const localSub = await this.prisma.givingSubscription.create({
      data: {
        churchId: params.churchId,
        fundId: params.fundId,
        donorMemberId: params.donorMemberId,
        stripeSubscriptionId: `pending_${randomUUID()}`,
        stripeCustomerId: customer.id,
        amountCents: params.amountCents,
        currency: 'brl',
        status: GivingSubscriptionStatus.incomplete,
        payerName: params.payerName,
        payerEmail: params.payerEmail,
      },
    });

    const donation = await this.prisma.givingDonation.create({
      data: {
        churchId: params.churchId,
        fundId: params.fundId,
        donorMemberId: params.donorMemberId,
        subscriptionId: localSub.id,
        amountCents: params.amountCents,
        currency: 'brl',
        status: GivingDonationStatus.pending,
        payerName: params.payerName,
        payerEmail: params.payerEmail,
      },
    });

    try {
      const subscription = await this.stripeConnect.createGivingSubscription({
        stripeAccountId: params.stripeAccountId,
        customerId: customer.id,
        amountCents: params.amountCents,
        fundId: params.fundId,
        productName: `${params.fundName} — ${params.churchName}`,
        applicationFeePercent,
        idempotencyKey: `giving_sub_${localSub.id}`,
        metadata: {
          minhachurch_subscription_id: localSub.id,
          minhachurch_donation_id: donation.id,
          minhachurch_church_id: params.churchId,
          minhachurch_fund_id: params.fundId,
          minhachurch_fund_slug: params.fundSlug,
          ...params.metadataExtra,
        },
      });

      const invoice = subscription.latest_invoice as Stripe.Invoice | null;
      const clientSecret = invoice?.confirmation_secret?.client_secret ?? null;
      const paymentIntentId = extractInvoicePaymentIntentId(invoice);

      if (!clientSecret) {
        throw new BadRequestException(
          'Não foi possível iniciar a contribuição mensal. Tente novamente.',
        );
      }

      await this.prisma.givingSubscription.update({
        where: { id: localSub.id },
        data: { stripeSubscriptionId: subscription.id },
      });

      await this.prisma.givingDonation.update({
        where: { id: donation.id },
        data: {
          stripePaymentIntentId: paymentIntentId,
          status: GivingDonationStatus.pending,
        },
      });

      return {
        donationId: donation.id,
        receiptToken: this.issueGivingReceiptToken(donation.id),
        subscriptionId: localSub.id,
        mode: 'subscription',
        clientSecret,
        stripeAccountId: params.stripeAccountId,
        publishableKey: params.publishableKey,
        amountCents: params.amountCents,
        currency: 'brl',
      };
    } catch (error) {
      await this.prisma.givingDonation.update({
        where: { id: donation.id },
        data: { status: GivingDonationStatus.failed },
      });
      await this.prisma.givingSubscription.update({
        where: { id: localSub.id },
        data: { status: GivingSubscriptionStatus.canceled, canceledAt: new Date() },
      });

      if (error instanceof BadRequestException) {
        throw error;
      }

      this.logger.error(
        `Falha ao criar assinatura de doação ${localSub.id}: ${
          error instanceof Error ? error.message : 'erro desconhecido'
        }`,
      );
      throw new BadRequestException(
        'Não foi possível iniciar a contribuição mensal. Tente novamente.',
      );
    }
  }

  async listMyGivingSubscriptions(
    churchId: string,
    userId: string,
  ): Promise<GivingSubscriptionResult[]> {
    const member = await this.prisma.member.findFirst({
      where: { churchId, userId, deletedAt: null },
      select: { id: true },
    });

    if (!member) {
      return [];
    }

    const subscriptions = await this.prisma.givingSubscription.findMany({
      where: {
        churchId,
        donorMemberId: member.id,
        status: {
          in: [
            GivingSubscriptionStatus.active,
            GivingSubscriptionStatus.past_due,
            GivingSubscriptionStatus.incomplete,
          ],
        },
      },
      include: {
        fund: { select: { id: true, name: true } },
        donorMember: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return subscriptions.map((sub) => this.toGivingSubscriptionResult(sub));
  }

  async listGivingSubscriptions(
    churchId: string,
    options?: { fundId?: string; status?: string },
  ): Promise<GivingSubscriptionResult[]> {
    const where: Prisma.GivingSubscriptionWhereInput = { churchId };

    if (options?.fundId) {
      where.fundId = options.fundId;
    }

    if (options?.status) {
      const status = options.status as GivingSubscriptionStatus;
      if (Object.values(GivingSubscriptionStatus).includes(status)) {
        where.status = status;
      }
    } else {
      where.status = {
        in: [
          GivingSubscriptionStatus.active,
          GivingSubscriptionStatus.past_due,
          GivingSubscriptionStatus.incomplete,
        ],
      };
    }

    const subscriptions = await this.prisma.givingSubscription.findMany({
      where,
      include: {
        fund: { select: { id: true, name: true } },
        donorMember: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    return subscriptions.map((sub) => this.toGivingSubscriptionResult(sub));
  }

  async cancelGivingSubscription(
    churchId: string,
    subscriptionId: string,
    userId: string,
    options?: { asTreasurer?: boolean },
  ): Promise<GivingSubscriptionResult> {
    this.stripeConnect.assertConfigured();

    const subscription = await this.prisma.givingSubscription.findFirst({
      where: { id: subscriptionId, churchId },
      include: {
        fund: { select: { id: true, name: true } },
        donorMember: { select: { id: true, name: true } },
      },
    });

    if (!subscription) {
      throw new NotFoundException('Assinatura não encontrada.');
    }

    if (!options?.asTreasurer) {
      const member = await this.prisma.member.findFirst({
        where: { churchId, userId, deletedAt: null },
        select: { id: true },
      });
      if (!member || subscription.donorMemberId !== member.id) {
        throw new ForbiddenException(
          'Você só pode cancelar suas próprias contribuições mensais.',
        );
      }
    }

    if (subscription.status === GivingSubscriptionStatus.canceled) {
      return this.toGivingSubscriptionResult(subscription);
    }

    await this.cancelOpenGivingSubscriptionRecord(subscription, churchId);

    const updated = await this.prisma.givingSubscription.findFirstOrThrow({
      where: { id: subscription.id, churchId },
      include: {
        fund: { select: { id: true, name: true } },
        donorMember: { select: { id: true, name: true } },
      },
    });

    return this.toGivingSubscriptionResult(updated);
  }

  /**
   * Cancela contribuições mensais abertas vinculadas a um membro pastoral.
   * Usado ao inativar/excluir membro — scoped por churchId + donorMemberId.
   * Nunca lança se Stripe falhar: atualiza estado local e registra warn.
   */
  async cancelOpenGivingSubscriptionsForMember(
    churchId: string,
    memberId: string,
  ): Promise<number> {
    return this.cancelOpenGivingSubscriptions({
      churchId,
      donorMemberId: memberId,
    });
  }

  /**
   * Cancela todas as contribuições mensais abertas da igreja.
   * Usado no encerramento da igreja — best-effort no Stripe, sempre cancela local.
   */
  async cancelOpenGivingSubscriptionsForChurch(
    churchId: string,
  ): Promise<number> {
    return this.cancelOpenGivingSubscriptions({ churchId });
  }

  private async cancelOpenGivingSubscriptions(filter: {
    churchId: string;
    donorMemberId?: string;
  }): Promise<number> {
    const open = await this.prisma.givingSubscription.findMany({
      where: {
        churchId: filter.churchId,
        ...(filter.donorMemberId
          ? { donorMemberId: filter.donorMemberId }
          : {}),
        status: {
          in: [
            GivingSubscriptionStatus.active,
            GivingSubscriptionStatus.past_due,
            GivingSubscriptionStatus.incomplete,
          ],
        },
      },
      select: {
        id: true,
        stripeSubscriptionId: true,
        status: true,
      },
    });

    if (open.length === 0) {
      return 0;
    }

    for (const subscription of open) {
      await this.cancelOpenGivingSubscriptionRecord(
        subscription,
        filter.churchId,
      );
    }

    this.logger.log(
      filter.donorMemberId
        ? `Canceladas ${open.length} contribuição(ões) mensal(is) do membro ${filter.donorMemberId} (igreja ${filter.churchId}).`
        : `Canceladas ${open.length} contribuição(ões) mensal(is) da igreja ${filter.churchId} (encerramento).`,
    );

    return open.length;
  }

  async countOpenGivingSubscriptionsForMember(
    churchId: string,
    memberId: string,
  ): Promise<number> {
    return this.prisma.givingSubscription.count({
      where: {
        churchId,
        donorMemberId: memberId,
        status: {
          in: [
            GivingSubscriptionStatus.active,
            GivingSubscriptionStatus.past_due,
            GivingSubscriptionStatus.incomplete,
          ],
        },
      },
    });
  }

  private async cancelOpenGivingSubscriptionRecord(
    subscription: {
      id: string;
      stripeSubscriptionId: string;
      status: string;
    },
    churchId: string,
  ): Promise<void> {
    if (subscription.status === GivingSubscriptionStatus.canceled) {
      return;
    }

    const account = await this.prisma.churchPaymentAccount.findUnique({
      where: { churchId },
      select: { stripeAccountId: true },
    });

    if (
      account?.stripeAccountId &&
      !subscription.stripeSubscriptionId.startsWith('pending_') &&
      this.stripeConnect.isConfigured()
    ) {
      try {
        await this.stripeConnect.cancelSubscription(
          subscription.stripeSubscriptionId,
          account.stripeAccountId,
        );
      } catch (error) {
        this.logger.warn(
          `Falha ao cancelar assinatura Stripe ${subscription.stripeSubscriptionId}: ${
            error instanceof Error ? error.message : 'erro desconhecido'
          }`,
        );
      }
    }

    await this.prisma.givingSubscription.update({
      where: { id: subscription.id },
      data: {
        status: GivingSubscriptionStatus.canceled,
        canceledAt: new Date(),
      },
    });
  }

  private toGivingSubscriptionResult(sub: {
    id: string;
    amountCents: number;
    currency: string;
    status: string;
    payerName: string | null;
    payerEmail: string | null;
    donorMemberId: string | null;
    canceledAt: Date | null;
    createdAt: Date;
    fund: { id: string; name: string };
    donorMember?: { id: string; name: string } | null;
  }): GivingSubscriptionResult {
    return {
      id: sub.id,
      fundId: sub.fund.id,
      fundName: sub.fund.name,
      amountCents: sub.amountCents,
      currency: sub.currency,
      status: sub.status,
      payerName: sub.payerName,
      payerEmail: sub.payerEmail,
      donorMemberId: sub.donorMemberId,
      donorMemberName: sub.donorMember?.name ?? null,
      canceledAt: sub.canceledAt?.toISOString() ?? null,
      createdAt: sub.createdAt.toISOString(),
    };
  }

  async startConnectOnboarding(churchId: string): Promise<{ url: string }> {
    this.stripeConnect.assertConfigured();
    await this.assertChurchNotClosed(churchId);

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
    await this.assertChurchNotClosed(churchId);

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

  async createExpressDashboardLink(
    churchId: string,
  ): Promise<{ url: string }> {
    this.stripeConnect.assertConfigured();
    await this.assertChurchNotClosed(churchId);

    const account = await this.prisma.churchPaymentAccount.findUnique({
      where: { churchId },
      select: { stripeAccountId: true, detailsSubmitted: true },
    });

    if (!account?.stripeAccountId) {
      throw new BadRequestException(
        'Ative os recebimentos antes de abrir o painel Stripe.',
      );
    }

    if (!account.detailsSubmitted) {
      throw new BadRequestException(
        'Conclua o cadastro de recebimentos antes de abrir o painel Stripe.',
      );
    }

    const link = await this.stripeConnect.createLoginLink(
      account.stripeAccountId,
    );

    return { url: link.url };
  }

  /**
   * Visão de repasses Stripe → banco da igreja.
   * Read-only: não altera agenda de payout nem dados bancários.
   */
  async getConnectPayoutsOverview(
    churchId: string,
    options?: { limit?: number },
  ): Promise<ConnectPayoutsOverviewResult> {
    this.stripeConnect.assertConfigured();
    await this.assertChurchNotClosed(churchId);

    const account = await this.prisma.churchPaymentAccount.findUnique({
      where: { churchId },
      select: {
        stripeAccountId: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
      },
    });

    if (!account?.stripeAccountId || !account.detailsSubmitted) {
      throw new BadRequestException(
        'Ative e conclua os recebimentos para ver os repasses ao banco.',
      );
    }

    const limit = Math.min(Math.max(options?.limit ?? 20, 1), 50);

    const [balance, payoutList] = await Promise.all([
      this.stripeConnect.retrieveConnectBalance(account.stripeAccountId),
      this.stripeConnect.listConnectPayouts(account.stripeAccountId, {
        limit,
      }),
    ]);

    const toBalanceAmounts = (
      items: Array<{ amount: number; currency: string }>,
    ) =>
      items.map((item) => ({
        amountCents: item.amount,
        currency: item.currency,
      }));

    return {
      payoutsEnabled: account.payoutsEnabled,
      available: toBalanceAmounts(balance.available),
      pending: toBalanceAmounts(balance.pending),
      payouts: payoutList.data.map((payout) =>
        this.toConnectPayoutResult(payout),
      ),
      hasMore: payoutList.has_more,
    };
  }

  private toConnectPayoutResult(payout: {
    id: string;
    amount: number;
    currency: string;
    status: string;
    arrival_date: number;
    created: number;
    method: string;
    description: string | null;
    failure_message: string | null;
  }): ConnectPayoutResult {
    const status = this.normalizeConnectPayoutStatus(payout.status);
    const arrival = new Date(payout.arrival_date * 1000);

    return {
      id: payout.id,
      amountCents: payout.amount,
      currency: payout.currency,
      status,
      arrivalDate: arrival.toISOString().slice(0, 10),
      createdAt: new Date(payout.created * 1000).toISOString(),
      method: payout.method,
      description: payout.description,
      failureMessage: payout.failure_message,
    };
  }

  private normalizeConnectPayoutStatus(status: string): ConnectPayoutStatus {
    switch (status) {
      case 'paid':
      case 'pending':
      case 'in_transit':
      case 'canceled':
      case 'failed':
        return status;
      default:
        return 'pending';
    }
  }

  async syncConnectAccount(churchId: string): Promise<ConnectStatusResult> {
    this.stripeConnect.assertConfigured();
    await this.assertChurchNotClosed(churchId);

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

    // Insert-first: unique on event.id serializa entregas concorrentes.
    // Se o dispatch falhar, removemos o claim para o Stripe poder retentar.
    try {
      await this.prisma.connectWebhookEvent.create({
        data: { id: event.id },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return { received: true, duplicate: true };
      }
      throw error;
    }

    try {
      await this.dispatchConnectEvent(event);
    } catch (error) {
      await this.prisma.connectWebhookEvent
        .delete({ where: { id: event.id } })
        .catch(() => undefined);
      throw error;
    }

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
        await this.syncTicketFromPaymentIntent(
          paymentIntent,
          event.type === 'payment_intent.payment_failed'
            ? EventTicketStatus.failed
            : undefined,
        );
        break;
      }
      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        await this.syncDonationFromPaidInvoice(invoice);
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await this.syncGivingSubscriptionFromStripe(subscription);
        break;
      }
      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge;
        await this.syncDonationRefundedFromCharge(charge);
        break;
      }
      case 'refund.updated': {
        const refund = event.data.object as Stripe.Refund;
        if (refund.status === 'succeeded') {
          await this.syncDonationRefundedFromRefund(refund);
        }
        break;
      }
      default:
        break;
    }
  }

  private async syncDonationRefundedFromCharge(
    charge: Stripe.Charge,
  ): Promise<void> {
    if (!charge.refunded) {
      return;
    }

    const paymentIntentId =
      typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : charge.payment_intent?.id;

    const donationId = charge.metadata?.minhachurch_donation_id;

    if (donationId) {
      await this.markGivingDonationRefundedAndNotify(donationId);
      return;
    }

    if (paymentIntentId) {
      const donation = await this.prisma.givingDonation.findFirst({
        where: { stripePaymentIntentId: paymentIntentId },
        select: { id: true },
      });
      if (donation) {
        await this.markGivingDonationRefundedAndNotify(donation.id);
      }
    }
  }

  private async syncDonationRefundedFromRefund(
    refund: Stripe.Refund,
  ): Promise<void> {
    const donationId = refund.metadata?.minhachurch_donation_id;
    if (donationId) {
      await this.markGivingDonationRefundedAndNotify(donationId);
      return;
    }

    const paymentIntentId =
      typeof refund.payment_intent === 'string'
        ? refund.payment_intent
        : refund.payment_intent?.id;

    if (paymentIntentId) {
      const donation = await this.prisma.givingDonation.findFirst({
        where: { stripePaymentIntentId: paymentIntentId },
        select: { id: true },
      });
      if (donation) {
        await this.markGivingDonationRefundedAndNotify(donation.id);
      }
    }
  }

  /**
   * Marca doação como estornada e notifica o doador (se tiver conta no app).
   * Idempotente: se já estava refunded, não reemite (API + webhook).
   */
  private async markGivingDonationRefundedAndNotify(
    donationId: string,
  ): Promise<void> {
    const donation = await this.prisma.givingDonation.findUnique({
      where: { id: donationId },
      select: {
        id: true,
        churchId: true,
        amountCents: true,
        currency: true,
        status: true,
        donorMemberId: true,
        fund: { select: { name: true } },
      },
    });

    if (!donation) {
      return;
    }

    if (donation.status === GivingDonationStatus.refunded) {
      return;
    }

    await this.prisma.givingDonation.update({
      where: { id: donation.id },
      data: { status: GivingDonationStatus.refunded },
    });

    this.notificationsService.schedule(
      this.notificationsService.emitGivingDonationRefunded({
        churchId: donation.churchId,
        donationId: donation.id,
        donorMemberId: donation.donorMemberId,
        amountCents: donation.amountCents,
        currency: donation.currency,
        fundName: donation.fund.name,
        resetRead: true,
      }),
      `giving_donation_refunded_webhook:${donation.id}`,
    );
  }

  private async syncDonationFromPaymentIntent(
    paymentIntent: Stripe.PaymentIntent,
    statusOverride?: GivingDonationStatus,
  ): Promise<void> {
    const donationId = paymentIntent.metadata?.minhachurch_donation_id;
    const status =
      statusOverride ?? resolveDonationStatusFromPaymentIntent(paymentIntent);

    if (donationId) {
      const updated = await this.prisma.givingDonation.updateMany({
        where: { id: donationId },
        data: {
          status,
          stripePaymentIntentId: paymentIntent.id,
        },
      });

      if (updated.count > 0) {
        const subscriptionId =
          paymentIntent.metadata?.minhachurch_subscription_id;
        if (
          subscriptionId &&
          status === GivingDonationStatus.succeeded
        ) {
          await this.prisma.givingSubscription.updateMany({
            where: { id: subscriptionId },
            data: { status: GivingSubscriptionStatus.active },
          });
        }
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

  private async syncTicketFromPaymentIntent(
    paymentIntent: Stripe.PaymentIntent,
    statusOverride?: EventTicketStatus,
  ): Promise<void> {
    const ticketId = paymentIntent.metadata?.minhachurch_ticket_id;
    const status =
      statusOverride ?? mapEventTicketStatusFromPaymentIntent(paymentIntent);

    if (ticketId) {
      await this.prisma.eventTicketPurchase.updateMany({
        where: { id: ticketId },
        data: {
          status,
          stripePaymentIntentId: paymentIntent.id,
        },
      });
      return;
    }

    if (paymentIntent.id) {
      await this.prisma.eventTicketPurchase.updateMany({
        where: { stripePaymentIntentId: paymentIntent.id },
        data: { status },
      });
    }
  }

  private async syncDonationFromPaidInvoice(
    invoice: Stripe.Invoice,
  ): Promise<void> {
    const subscriptionIdMeta = invoice.metadata?.minhachurch_subscription_id;
    const stripeSubscriptionId = extractInvoiceSubscriptionId(invoice);

    let localSub = subscriptionIdMeta
      ? await this.prisma.givingSubscription.findUnique({
          where: { id: subscriptionIdMeta },
        })
      : null;

    if (!localSub && stripeSubscriptionId) {
      localSub = await this.prisma.givingSubscription.findUnique({
        where: { stripeSubscriptionId },
      });
    }

    if (!localSub) {
      return;
    }

    await this.prisma.givingSubscription.update({
      where: { id: localSub.id },
      data: { status: GivingSubscriptionStatus.active },
    });

    const paymentIntentId = extractInvoicePaymentIntentId(invoice);

    // Primeiro ciclo já cria GivingDonation no checkout; ciclos seguintes geram novo registro.
    if (paymentIntentId) {
      const existing = await this.prisma.givingDonation.findFirst({
        where: { stripePaymentIntentId: paymentIntentId },
      });
      if (existing) {
        await this.prisma.givingDonation.update({
          where: { id: existing.id },
          data: { status: GivingDonationStatus.succeeded },
        });
        return;
      }
    }

    const billingReason = invoice.billing_reason;
    if (billingReason === 'subscription_create') {
      return;
    }

    await this.prisma.givingDonation.create({
      data: {
        churchId: localSub.churchId,
        fundId: localSub.fundId,
        donorMemberId: localSub.donorMemberId,
        subscriptionId: localSub.id,
        stripePaymentIntentId: paymentIntentId ?? undefined,
        amountCents: localSub.amountCents,
        currency: localSub.currency,
        status: GivingDonationStatus.succeeded,
        payerName: localSub.payerName,
        payerEmail: localSub.payerEmail,
      },
    });
  }

  private async syncGivingSubscriptionFromStripe(
    subscription: Stripe.Subscription,
  ): Promise<void> {
    const localId = subscription.metadata?.minhachurch_subscription_id;
    const where = localId
      ? { id: localId }
      : { stripeSubscriptionId: subscription.id };

    const status = mapGivingSubscriptionStatus(subscription.status);
    await this.prisma.givingSubscription.updateMany({
      where,
      data: {
        status,
        canceledAt:
          status === GivingSubscriptionStatus.canceled
            ? new Date()
            : undefined,
        stripeSubscriptionId: subscription.id,
      },
    });
  }

  async createEventTicketCheckout(
    churchId: string,
    eventId: string,
    userId: string,
  ): Promise<GivingCheckoutResult> {
    this.stripeConnect.assertConfigured();

    const publishableKey = this.stripeConnect.getPublishableKey();
    if (!publishableKey) {
      throw new BadRequestException(
        'Chave pública do Stripe não configurada no servidor.',
      );
    }

    const event = await this.prisma.ministryEvent.findFirst({
      where: { id: eventId, churchId, deletedAt: null },
      select: {
        id: true,
        name: true,
        priceCents: true,
        registrationOpen: true,
      },
    });

    if (!event) {
      throw new NotFoundException('Evento não encontrado.');
    }

    if (!event.registrationOpen) {
      throw new BadRequestException(
        'A inscrição neste evento não está aberta.',
      );
    }

    if (!event.priceCents || event.priceCents < GIVING_MIN_AMOUNT_CENTS) {
      throw new BadRequestException(
        'Este evento não possui inscrição paga configurada.',
      );
    }

    const church = await this.prisma.church.findUnique({
      where: { id: churchId },
      select: { name: true, deletedAt: true },
    });

    if (!church) {
      throw new NotFoundException('Igreja não encontrada.');
    }

    this.assertChurchAcceptsPayments(church.deletedAt);

    const member = await this.requireActiveMember(churchId, userId);
    const account = await this.prisma.churchPaymentAccount.findUnique({
      where: { churchId },
    });

    if (!account?.stripeAccountId || !account.chargesEnabled) {
      throw new BadRequestException(
        'A igreja ainda não está apta a receber pagamentos.',
      );
    }

    const alreadyPaid = await this.prisma.eventTicketPurchase.findFirst({
      where: {
        eventId,
        memberId: member.id,
        status: EventTicketStatus.succeeded,
      },
    });

    if (alreadyPaid) {
      throw new ConflictException('Você já possui inscrição paga neste evento.');
    }

    const payerEmail =
      emptyToNull(member.email ?? undefined)?.toLowerCase() ??
      emptyToNull(member.userEmail ?? undefined)?.toLowerCase() ??
      null;

    const existingPendings = await this.prisma.eventTicketPurchase.findMany({
      where: {
        eventId,
        memberId: member.id,
        status: EventTicketStatus.pending,
      },
      orderBy: { createdAt: 'desc' },
    });

    const feeBps =
      this.configService.get<number>('payments.platformFeeBps') ?? 0;
    const applicationFeeAmount =
      feeBps > 0 ? Math.floor((event.priceCents * feeBps) / 10_000) : 0;

    const allowedPaymentMethodTypes: Array<'pix' | 'card' | 'boleto'> = [];
    if (account.cardStatus === ConnectCapabilityStatus.active) {
      allowedPaymentMethodTypes.push('card');
    }
    if (account.pixStatus === ConnectCapabilityStatus.active) {
      allowedPaymentMethodTypes.push('pix');
    }
    if (account.boletoStatus === ConnectCapabilityStatus.active) {
      allowedPaymentMethodTypes.push('boleto');
    }

    if (allowedPaymentMethodTypes.length === 0) {
      throw new BadRequestException(
        'Nenhum meio de pagamento ativo na conta de recebimentos.',
      );
    }

    const reusable = await this.resolveReusableEventTicketCheckout({
      tickets: existingPendings,
      stripeAccountId: account.stripeAccountId,
      expectedAmountCents: event.priceCents,
      publishableKey,
    });

    if (reusable) {
      return reusable;
    }

    const ticket = await this.prisma.eventTicketPurchase.create({
      data: {
        churchId,
        eventId,
        memberId: member.id,
        amountCents: event.priceCents,
        currency: 'brl',
        status: EventTicketStatus.pending,
        buyerName: member.name,
        buyerEmail: payerEmail,
      },
    });

    try {
      const paymentIntent = await this.stripeConnect.createPaymentIntent({
        stripeAccountId: account.stripeAccountId,
        amountCents: event.priceCents,
        applicationFeeAmount,
        receiptEmail: payerEmail ?? undefined,
        description: `Inscrição — ${event.name} (${church?.name ?? 'Igreja'})`,
        allowedPaymentMethodTypes,
        idempotencyKey: `ticket_pi_${ticket.id}`,
        metadata: {
          minhachurch_ticket_id: ticket.id,
          minhachurch_church_id: churchId,
          minhachurch_event_id: eventId,
          minhachurch_member_id: member.id,
        },
      });

      if (!paymentIntent.client_secret) {
        throw new BadRequestException(
          'Não foi possível iniciar o pagamento da inscrição.',
        );
      }

      await this.prisma.eventTicketPurchase.update({
        where: { id: ticket.id },
        data: { stripePaymentIntentId: paymentIntent.id },
      });

      return {
        donationId: ticket.id,
        receiptToken: this.issueGivingReceiptToken(ticket.id),
        subscriptionId: null,
        mode: 'payment',
        clientSecret: paymentIntent.client_secret,
        stripeAccountId: account.stripeAccountId,
        publishableKey,
        amountCents: event.priceCents,
        currency: 'brl',
      };
    } catch (error) {
      await this.prisma.eventTicketPurchase.update({
        where: { id: ticket.id },
        data: { status: EventTicketStatus.failed },
      });

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new BadRequestException(
        'Não foi possível iniciar o pagamento da inscrição.',
      );
    }
  }

  /**
   * Reusa um pending ativo (mesmo PI) ou cancela pendentes órfãos/invalidos.
   * Garante no máximo um pending reutilizável por membro+evento.
   */
  private async resolveReusableEventTicketCheckout(params: {
    tickets: Array<{
      id: string;
      amountCents: number;
      stripePaymentIntentId: string | null;
    }>;
    stripeAccountId: string;
    expectedAmountCents: number;
    publishableKey: string;
  }): Promise<GivingCheckoutResult | null> {
    if (params.tickets.length === 0) {
      return null;
    }

    let reusable: GivingCheckoutResult | null = null;

    for (const ticket of params.tickets) {
      if (reusable) {
        await this.cancelEventTicketCheckoutAttempt(
          ticket,
          params.stripeAccountId,
        );
        continue;
      }

      if (!ticket.stripePaymentIntentId) {
        await this.prisma.eventTicketPurchase.update({
          where: { id: ticket.id },
          data: { status: EventTicketStatus.canceled },
        });
        continue;
      }

      try {
        const paymentIntent = await this.stripeConnect.retrievePaymentIntent(
          ticket.stripePaymentIntentId,
          params.stripeAccountId,
        );

        if (paymentIntent.status === 'succeeded') {
          await this.syncTicketFromPaymentIntent(
            paymentIntent,
            EventTicketStatus.succeeded,
          );
          for (const other of params.tickets) {
            if (other.id === ticket.id) {
              continue;
            }
            await this.cancelEventTicketCheckoutAttempt(
              other,
              params.stripeAccountId,
            );
          }
          throw new ConflictException(
            'Você já possui inscrição paga neste evento.',
          );
        }

        const localStatus = mapEventTicketStatusFromPaymentIntent(paymentIntent);
        if (
          localStatus === EventTicketStatus.canceled ||
          localStatus === EventTicketStatus.failed
        ) {
          await this.prisma.eventTicketPurchase.update({
            where: { id: ticket.id },
            data: { status: localStatus },
          });
          continue;
        }

        if (
          paymentIntent.amount !== params.expectedAmountCents ||
          ticket.amountCents !== params.expectedAmountCents ||
          !paymentIntent.client_secret
        ) {
          await this.cancelEventTicketCheckoutAttempt(
            ticket,
            params.stripeAccountId,
          );
          continue;
        }

        reusable = {
          donationId: ticket.id,
          receiptToken: this.issueGivingReceiptToken(ticket.id),
          subscriptionId: null,
          mode: 'payment',
          clientSecret: paymentIntent.client_secret,
          stripeAccountId: params.stripeAccountId,
          publishableKey: params.publishableKey,
          amountCents: params.expectedAmountCents,
          currency: 'brl',
        };
      } catch (error) {
        if (error instanceof ConflictException) {
          throw error;
        }

        this.logger.warn(
          `Falha ao reusar ticket ${ticket.id}: ${
            error instanceof Error ? error.message : 'erro desconhecido'
          }`,
        );
        await this.cancelEventTicketCheckoutAttempt(
          ticket,
          params.stripeAccountId,
        );
      }
    }

    return reusable;
  }

  private issueGivingReceiptToken(donationId: string): string {
    const secret = this.configService.getOrThrow<string>('jwt.secret');
    return createGivingReceiptToken(donationId, secret);
  }

  private async cancelEventTicketCheckoutAttempt(
    ticket: { id: string; stripePaymentIntentId: string | null },
    stripeAccountId: string,
  ): Promise<void> {
    if (ticket.stripePaymentIntentId) {
      try {
        await this.stripeConnect.cancelPaymentIntent(
          ticket.stripePaymentIntentId,
          stripeAccountId,
        );
      } catch (error) {
        this.logger.warn(
          `Falha ao cancelar PaymentIntent ${ticket.stripePaymentIntentId}: ${
            error instanceof Error ? error.message : 'erro desconhecido'
          }`,
        );
      }
    }

    await this.prisma.eventTicketPurchase.update({
      where: { id: ticket.id },
      data: { status: EventTicketStatus.canceled },
    });
  }

  /**
   * Bloqueia criação de cobranças / onboarding Connect após encerramento.
   * Soft-delete da igreja (deletedAt) — não apaga a conta Express no Stripe.
   */
  private assertChurchAcceptsPayments(
    deletedAt: Date | null | undefined,
  ): void {
    if (deletedAt) {
      throw new ForbiddenException(
        'Esta igreja encerrou as atividades e não está recebendo pagamentos.',
      );
    }
  }

  private async assertChurchNotClosed(churchId: string): Promise<void> {
    const church = await this.prisma.church.findUnique({
      where: { id: churchId },
      select: { deletedAt: true },
    });

    if (!church) {
      throw new NotFoundException('Igreja não encontrada.');
    }

    this.assertChurchAcceptsPayments(church.deletedAt);
  }

  private async requireActiveMember(churchId: string, userId: string) {
    const member = await this.prisma.member.findFirst({
      where: { churchId, userId, deletedAt: null },
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        user: { select: { email: true } },
      },
    });

    if (!member) {
      throw new ForbiddenException(
        'É necessário ter um cadastro pastoral vinculado para contribuir por aqui.',
      );
    }

    if (member.status !== MemberStatus.active) {
      throw new ForbiddenException(
        'Somente membros ativos podem contribuir por Dízimos e ofertas.',
      );
    }

    return {
      id: member.id,
      name: member.name,
      email: member.email,
      userEmail: member.user?.email ?? null,
    };
  }

  private async resolveMemberGivingContext(
    churchId: string,
    fundId: string,
  ): Promise<{
    church: { id: string; name: string; slug: string };
    fund: {
      id: string;
      name: string;
      slug: string;
      description: string | null;
      allowPix: boolean;
      allowCard: boolean;
      allowBoleto: boolean;
    };
    stripeAccountId: string;
    accountCapabilities: {
      pixStatus: ConnectCapabilityStatus;
      cardStatus: ConnectCapabilityStatus;
      boletoStatus: ConnectCapabilityStatus;
    };
  }> {
    const church = await this.prisma.church.findUnique({
      where: { id: churchId },
      select: {
        id: true,
        name: true,
        slug: true,
        deletedAt: true,
        subscriptionStatus: true,
        trialEndsAt: true,
        pastDueSince: true,
        paymentAccount: {
          select: {
            stripeAccountId: true,
            chargesEnabled: true,
            pixStatus: true,
            cardStatus: true,
            boletoStatus: true,
          },
        },
      },
    });

    if (!church) {
      throw new NotFoundException('Igreja não encontrada.');
    }

    this.assertChurchAcceptsPayments(church.deletedAt);

    if (!this.subscriptionPolicy.isPublicGivingEntitled(church)) {
      throw new ForbiddenException(
        'Os recebimentos desta igreja estão temporariamente indisponíveis.',
      );
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
        id: fundId,
        churchId: church.id,
        isActive: true,
        audience: GivingFundAudience.members,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        allowPix: true,
        allowCard: true,
        allowBoleto: true,
      },
    });

    if (!fund) {
      throw new NotFoundException('Fundo de contribuição não encontrado.');
    }

    return {
      church: {
        id: church.id,
        name: church.name,
        slug: church.slug,
      },
      fund,
      stripeAccountId: church.paymentAccount.stripeAccountId,
      accountCapabilities: {
        pixStatus: church.paymentAccount.pixStatus,
        cardStatus: church.paymentAccount.cardStatus,
        boletoStatus: church.paymentAccount.boletoStatus,
      },
    };
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
      allowPix: boolean;
      allowCard: boolean;
      allowBoleto: boolean;
    };
    stripeAccountId: string;
    accountCapabilities: {
      pixStatus: ConnectCapabilityStatus;
      cardStatus: ConnectCapabilityStatus;
      boletoStatus: ConnectCapabilityStatus;
    };
  }> {
    const church = await this.prisma.church.findUnique({
      where: { slug: churchSlug },
      select: {
        id: true,
        name: true,
        slug: true,
        deletedAt: true,
        subscriptionStatus: true,
        trialEndsAt: true,
        pastDueSince: true,
        paymentAccount: {
          select: {
            stripeAccountId: true,
            chargesEnabled: true,
            pixStatus: true,
            cardStatus: true,
            boletoStatus: true,
          },
        },
      },
    });

    if (!church) {
      throw new NotFoundException('Página de contribuição não encontrada.');
    }

    this.assertChurchAcceptsPayments(church.deletedAt);

    // Recebimentos são premium: página pública fica no ar com plano ativo / trial
    // válido e, em past_due, durante a janela de graça. Fora disso, indisponível.
    if (!this.subscriptionPolicy.isPublicGivingEntitled(church)) {
      throw new ForbiddenException(
        'Os recebimentos desta igreja estão temporariamente indisponíveis. Tente novamente em breve.',
      );
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
        audience: GivingFundAudience.public,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        allowPix: true,
        allowCard: true,
        allowBoleto: true,
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
      accountCapabilities: {
        pixStatus: church.paymentAccount.pixStatus,
        cardStatus: church.paymentAccount.cardStatus,
        boletoStatus: church.paymentAccount.boletoStatus,
      },
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
    audience: GivingFundAudience;
    allowPix: boolean;
    allowCard: boolean;
    allowBoleto: boolean;
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
      audience: fund.audience,
      paymentMethods: {
        pix: fund.allowPix,
        card: fund.allowCard,
        boleto: fund.allowBoleto,
      },
      isActive: fund.isActive,
      canDelete: (fund._count?.donations ?? 0) === 0,
      sortOrder: fund.sortOrder,
      createdAt: fund.createdAt.toISOString(),
      updatedAt: fund.updatedAt.toISOString(),
    };
  }

  /**
   * Persiste só o que o criador pediu e que a conta Connect realmente cobre.
   * Exige pelo menos um meio ativo selecionado.
   */
  private normalizeFundPaymentMethods(params: {
    allowPix: boolean;
    allowCard: boolean;
    allowBoleto: boolean;
    account: {
      pixStatus: ConnectCapabilityStatus;
      cardStatus: ConnectCapabilityStatus;
      boletoStatus: ConnectCapabilityStatus;
    } | null;
  }): { pix: boolean; card: boolean; boleto: boolean } {
    if (!params.allowPix && !params.allowCard && !params.allowBoleto) {
      throw new BadRequestException(
        'Selecione pelo menos um meio de pagamento para o fundo.',
      );
    }

    const pixActive = params.account?.pixStatus === ConnectCapabilityStatus.active;
    const cardActive =
      params.account?.cardStatus === ConnectCapabilityStatus.active;
    const boletoActive =
      params.account?.boletoStatus === ConnectCapabilityStatus.active;

    if (!pixActive && !cardActive && !boletoActive) {
      throw new BadRequestException(
        'Nenhum meio de pagamento está ativo na conta de recebimentos. Conclua a ativação em Configurações → Recebimentos.',
      );
    }

    const pix = Boolean(params.allowPix && pixActive);
    const card = Boolean(params.allowCard && cardActive);
    const boleto = Boolean(params.allowBoleto && boletoActive);

    if (!pix && !card && !boleto) {
      throw new BadRequestException(
        'Os meios selecionados ainda não estão ativos na conta de recebimentos. Escolha um meio disponível.',
      );
    }

    return { pix, card, boleto };
  }

  private resolveCheckoutPaymentMethodTypes(params: {
    allowPix: boolean;
    allowCard: boolean;
    allowBoleto: boolean;
    account: {
      pixStatus: ConnectCapabilityStatus;
      cardStatus: ConnectCapabilityStatus;
      boletoStatus: ConnectCapabilityStatus;
    };
  }): Array<'pix' | 'card' | 'boleto'> {
    const types: Array<'pix' | 'card' | 'boleto'> = [];

    if (
      params.allowPix &&
      params.account.pixStatus === ConnectCapabilityStatus.active
    ) {
      types.push('pix');
    }
    if (
      params.allowCard &&
      params.account.cardStatus === ConnectCapabilityStatus.active
    ) {
      types.push('card');
    }
    if (
      params.allowBoleto &&
      params.account.boletoStatus === ConnectCapabilityStatus.active
    ) {
      types.push('boleto');
    }

    return types;
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

function resolveDonationStatusFromPaymentIntent(
  paymentIntent: Stripe.PaymentIntent,
): GivingDonationStatus {
  const nextActionType = paymentIntent.next_action?.type;
  // Boleto/Pix com instruções geradas: aguardando pagamento do pagador.
  if (
    paymentIntent.status === 'requires_action' &&
    (nextActionType === 'boleto_display_details' ||
      nextActionType === 'display_bank_transfer_instructions' ||
      nextActionType === 'pix_display_qr_code')
  ) {
    return GivingDonationStatus.processing;
  }

  return mapPaymentIntentStatus(paymentIntent.status);
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
      return GivingDonationStatus.pending;
  }
}

function mapDonationOutcome(
  status: GivingDonationStatus | string,
): GivingDonationOutcome {
  switch (status) {
    case GivingDonationStatus.succeeded:
    case 'succeeded':
      return 'succeeded';
    case GivingDonationStatus.processing:
    case 'processing':
      return 'processing';
    case GivingDonationStatus.failed:
    case GivingDonationStatus.canceled:
    case GivingDonationStatus.refunded:
    case 'failed':
    case 'canceled':
    case 'refunded':
      return 'failed';
    default:
      return 'incomplete';
  }
}

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

const CSV_TIME_ZONE = 'America/Sao_Paulo';

function formatCsvDateTime(value: Date): string {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: CSV_TIME_ZONE,
  }).formatToParts(value);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';

  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
}

function formatCsvDate(value: Date): string {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: CSV_TIME_ZONE,
  }).formatToParts(value);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';

  return `${get('day')}/${get('month')}/${get('year')}`;
}

function formatCsvCurrency(amountCents: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(amountCents / 100);
}

function formatGivingDonationStatusLabel(
  status: GivingDonationStatus,
): string {
  switch (status) {
    case GivingDonationStatus.pending:
      return 'Pendente';
    case GivingDonationStatus.processing:
      return 'Processando';
    case GivingDonationStatus.succeeded:
      return 'Confirmada';
    case GivingDonationStatus.failed:
      return 'Falhou';
    case GivingDonationStatus.canceled:
      return 'Cancelada';
    case GivingDonationStatus.refunded:
      return 'Estornada';
    default:
      return status;
  }
}

function formatFinanceEntrySourceLabel(
  source: 'manual' | 'online' | 'event_ticket',
): string {
  if (source === 'manual') return 'Manual';
  if (source === 'event_ticket') return 'Inscrição';
  return 'Online';
}

function formatEventTicketStatusLabel(status: EventTicketStatus): string {
  switch (status) {
    case EventTicketStatus.pending:
      return 'Pendente';
    case EventTicketStatus.succeeded:
      return 'Confirmada';
    case EventTicketStatus.failed:
      return 'Falhou';
    case EventTicketStatus.canceled:
      return 'Cancelada';
    case EventTicketStatus.refunded:
      return 'Estornada';
    default:
      return status;
  }
}

function formatFinanceEntryTypeLabel(type: FinanceEntryType | 'income'): string {
  return type === FinanceEntryType.expense ? 'Saída' : 'Entrada';
}

function formatFinanceEntryMethodLabel(
  method: FinanceEntryMethod | 'online',
): string {
  switch (method) {
    case FinanceEntryMethod.cash:
      return 'Dinheiro';
    case FinanceEntryMethod.transfer:
      return 'Transferência';
    case FinanceEntryMethod.other:
      return 'Outro';
    case 'online':
      return 'Online';
    default:
      return method;
  }
}

function mapEventTicketStatusFromPaymentIntent(
  paymentIntent: Stripe.PaymentIntent,
): EventTicketStatus {
  switch (paymentIntent.status) {
    case 'succeeded':
      return EventTicketStatus.succeeded;
    case 'processing':
      return EventTicketStatus.pending;
    case 'canceled':
      return EventTicketStatus.canceled;
    case 'requires_payment_method':
    case 'requires_confirmation':
    case 'requires_action':
      return EventTicketStatus.pending;
    default:
      return EventTicketStatus.pending;
  }
}

function mapGivingSubscriptionStatus(
  status: Stripe.Subscription.Status,
): GivingSubscriptionStatus {
  switch (status) {
    case 'active':
    case 'trialing':
      return GivingSubscriptionStatus.active;
    case 'past_due':
    case 'unpaid':
      return GivingSubscriptionStatus.past_due;
    case 'canceled':
    case 'incomplete_expired':
      return GivingSubscriptionStatus.canceled;
    case 'incomplete':
    default:
      return GivingSubscriptionStatus.incomplete;
  }
}

function extractInvoiceSubscriptionId(
  invoice: Stripe.Invoice | null | undefined,
): string | null {
  const details = invoice?.parent?.subscription_details?.subscription;
  if (!details) {
    return null;
  }
  return typeof details === 'string' ? details : details.id;
}

function extractInvoicePaymentIntentId(
  invoice: Stripe.Invoice | null | undefined,
): string | null {
  const payments = invoice?.payments?.data ?? [];
  for (const item of payments) {
    const payment = item.payment;
    if (!payment || typeof payment !== 'object') {
      continue;
    }
    const paymentIntent = (
      payment as { payment_intent?: string | Stripe.PaymentIntent | null }
    ).payment_intent;
    if (typeof paymentIntent === 'string') {
      return paymentIntent;
    }
    if (paymentIntent && typeof paymentIntent === 'object') {
      return paymentIntent.id;
    }
  }
  return null;
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
