import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BillingTierUpgradeRequestStatus,
  ChurchPermission,
  SubscriptionStatus,
} from '@prisma/client';
import Stripe from 'stripe';

import {
  BILLING_TIER_IDS,
  billingTierFromMemberCount,
  getBillingTierCatalogEntry,
  isBillingTierUpgrade,
  PRICING_CATALOG,
  wouldUpgradeBillingTier,
  type BillingInterval,
  type BillingTierId,
} from '../../config/billing-plans.config';
import { ChurchPermissionsService } from '../../common/services/church-permissions.service';
import { SubscriptionPolicyService } from '../../common/services/subscription-policy.service';
import { EmailService } from '../../common/services/email.service';
import { resolveUserContactEmail } from '../../common/utils/user-contact-email';
import { PrismaService } from '../../database/prisma.service';

export interface CheckoutConfirmResult {
  subscriptionStatus: SubscriptionStatus;
  tierId: BillingTierId;
  interval: BillingInterval;
}

export interface SubscriptionSummaryResult {
  subscriptionStatus: SubscriptionStatus;
  trialEndsAt: string | null;
  trialDaysRemaining: number | null;
  featuresLocked: boolean;
  tierId: BillingTierId;
  interval: BillingInterval | null;
  memberCount: number;
  canManageBilling: boolean;
  hasActiveSubscription: boolean;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  canceledAt: string | null;
}

export interface TierCrossingPreviewResult {
  crossesTier: boolean;
  requiresConfirmation: boolean;
  currentMemberCount: number;
  projectedMemberCount: number;
  currentTierId: BillingTierId;
  projectedTierId: BillingTierId;
  currentTierName: string;
  projectedTierName: string;
  currentTierMemberRange: string;
  projectedTierMemberRange: string;
  hasActiveSubscription: boolean;
  interval: BillingInterval | null;
  currentPrice: number | null;
  projectedPrice: number | null;
  priceDelta: number | null;
}

export interface ConfirmTierCrossingResult {
  acknowledged: boolean;
  projectedTierId: BillingTierId;
}

/**
 * Snapshot mínimo da igreja para avaliar cruzamento de faixa sem reler o banco
 * quem já buscou esses campos (ex.: create de membro ativo).
 */
export interface TierCrossingChurchSnapshot {
  memberCount: number;
  subscriptionStatus: SubscriptionStatus;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
}

export interface TierCrossingRequestResult {
  id: string;
  status: BillingTierUpgradeRequestStatus;
  targetTierId: BillingTierId;
  currentTierId: BillingTierId;
  currentTierName: string;
  projectedTierName: string;
  currentTierMemberRange: string;
  projectedTierMemberRange: string;
  currentPrice: number | null;
  projectedPrice: number | null;
  interval: BillingInterval | null;
  hasActiveSubscription: boolean;
  emailSent: boolean;
  requestedByName: string | null;
}

export interface TierCrossingStaffNoticeResult {
  id: string;
  tierId: BillingTierId;
  tierName: string;
  createdAt: string;
}

export interface BillingInvoiceResult {
  id: string;
  number: string | null;
  status: string;
  amountPaid: number;
  currency: string;
  createdAt: string;
  periodStart: string | null;
  periodEnd: string | null;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly stripe: Stripe;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly subscriptionPolicy: SubscriptionPolicyService,
    private readonly emailService: EmailService,
    private readonly churchPermissions: ChurchPermissionsService,
  ) {
    const secretKey = this.configService.get<string>('stripe.secretKey') ?? '';

    this.stripe = new Stripe(secretKey || 'sk_test_placeholder');
  }

  getPricingCatalog() {
    return PRICING_CATALOG;
  }

  async createCheckoutSession(
    churchId: string,
    interval: BillingInterval,
  ): Promise<{ url: string }> {
    this.assertStripeConfigured();

    const church = await this.prisma.church.findUnique({
      where: { id: churchId },
    });

    if (!church) {
      throw new NotFoundException('Igreja não encontrada.');
    }

    this.assertCanStartCheckout(church);

    const tierId = billingTierFromMemberCount(church.memberCount);
    const priceId = this.resolveStripePriceId(tierId, interval);
    const customerId = await this.getOrCreateStripeCustomer(church.id, church.name);
    const appUrl = this.configService.getOrThrow<string>('appUrl');
    const tier = getBillingTierCatalogEntry(tierId);

    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      locale: 'pt-BR',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/app/dashboard?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/app/configuracoes?section=subscription&checkout=canceled`,
      metadata: {
        churchId,
        tierId,
        interval,
      },
      subscription_data: {
        metadata: {
          churchId,
          tierId,
        },
      },
      custom_text: {
        submit: {
          message: `Faixa ${tier.name} — ${tier.memberRange}`,
        },
      },
    });

    if (!session.url) {
      throw new BadRequestException(
        'Não foi possível iniciar o checkout. Tente novamente.',
      );
    }

    return { url: session.url };
  }

  async confirmCheckoutSession(
    churchId: string,
    sessionId: string,
  ): Promise<CheckoutConfirmResult> {
    this.assertStripeConfigured();

    const session = await this.stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription'],
    });

    if (session.metadata?.churchId !== churchId) {
      throw new ForbiddenException(
        'Sessão de checkout não pertence a esta igreja.',
      );
    }

    if (session.mode !== 'subscription') {
      throw new BadRequestException('Sessão de checkout inválida.');
    }

    if (session.status !== 'complete') {
      throw new BadRequestException('Checkout ainda não foi concluído.');
    }

    await this.syncFromCompletedCheckoutSession(session);

    const church = await this.prisma.church.findUnique({
      where: { id: churchId },
      select: { subscriptionStatus: true, memberCount: true },
    });

    if (!church) {
      throw new NotFoundException('Igreja não encontrada.');
    }

    const tierId =
      (session.metadata?.tierId as BillingTierId | undefined) ??
      billingTierFromMemberCount(church.memberCount);
    const interval =
      session.metadata?.interval === 'yearly' ? 'yearly' : 'monthly';

    return {
      subscriptionStatus: church.subscriptionStatus,
      tierId,
      interval,
    };
  }

  async getSubscriptionSummary(
    churchId: string,
  ): Promise<SubscriptionSummaryResult> {
    const church = await this.prisma.church.findUnique({
      where: { id: churchId },
      select: {
        subscriptionStatus: true,
        trialEndsAt: true,
        memberCount: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
        stripePriceId: true,
      },
    });

    if (!church) {
      throw new NotFoundException('Igreja não encontrada.');
    }

    const policySummary = this.subscriptionPolicy.buildSummary(church);
    const tierId = billingTierFromMemberCount(church.memberCount);
    const priceMatch = church.stripePriceId
      ? this.resolveTierAndIntervalFromPriceId(church.stripePriceId)
      : null;

    let cancelAtPeriodEnd = false;
    let currentPeriodEnd: string | null = null;
    let canceledAt: string | null = null;
    let syncedStatus = church.subscriptionStatus;

    if (church.stripeSubscriptionId) {
      try {
        const subscription = await this.stripe.subscriptions.retrieve(
          church.stripeSubscriptionId,
        );

        await this.syncSubscriptionToChurch(churchId, subscription);

        const refreshed = await this.prisma.church.findUnique({
          where: { id: churchId },
          select: { subscriptionStatus: true },
        });

        syncedStatus =
          refreshed?.subscriptionStatus ?? church.subscriptionStatus;

        const schedule = this.readStripeSubscriptionSchedule(subscription);
        cancelAtPeriodEnd = schedule.cancelAtPeriodEnd;
        currentPeriodEnd = schedule.currentPeriodEnd;
        canceledAt = schedule.canceledAt;
      } catch (error) {
        this.logger.warn(
          `Falha ao sincronizar assinatura ${church.stripeSubscriptionId}: ${
            error instanceof Error ? error.message : 'erro desconhecido'
          }`,
        );
      }
    }

    const refreshedPolicy = this.subscriptionPolicy.buildSummary({
      subscriptionStatus: syncedStatus,
      trialEndsAt: church.trialEndsAt,
    });

    return {
      ...refreshedPolicy,
      tierId: priceMatch?.tierId ?? tierId,
      interval: priceMatch?.interval ?? null,
      memberCount: church.memberCount,
      canManageBilling: Boolean(church.stripeCustomerId),
      hasActiveSubscription:
        syncedStatus === SubscriptionStatus.active &&
        Boolean(church.stripeSubscriptionId),
      cancelAtPeriodEnd,
      currentPeriodEnd,
      canceledAt,
    };
  }

  async previewTierCrossing(
    churchId: string,
    projectedMemberCount: number,
    churchSnapshot?: TierCrossingChurchSnapshot,
  ): Promise<TierCrossingPreviewResult> {
    if (!Number.isInteger(projectedMemberCount) || projectedMemberCount < 0) {
      throw new BadRequestException('Quantidade de membros inválida.');
    }

    const church =
      churchSnapshot ??
      (await this.prisma.church.findUnique({
        where: { id: churchId },
        select: {
          memberCount: true,
          subscriptionStatus: true,
          stripeSubscriptionId: true,
          stripePriceId: true,
        },
      }));

    if (!church) {
      throw new NotFoundException('Igreja não encontrada.');
    }

    const currentTierId = billingTierFromMemberCount(church.memberCount);
    const projectedTierId = billingTierFromMemberCount(projectedMemberCount);
    const crossesTier = wouldUpgradeBillingTier(
      church.memberCount,
      projectedMemberCount,
    );

    const acknowledgment =
      crossesTier
        ? await this.prisma.billingTierUpgradeAcknowledgment.findUnique({
            where: {
              churchId_tierId: {
                churchId,
                tierId: projectedTierId,
              },
            },
          })
        : null;

    const currentTier = getBillingTierCatalogEntry(currentTierId);
    const projectedTier = getBillingTierCatalogEntry(projectedTierId);
    const priceMatch = church.stripePriceId
      ? this.resolveTierAndIntervalFromPriceId(church.stripePriceId)
      : null;
    const interval = priceMatch?.interval ?? null;
    const displayInterval: BillingInterval = interval ?? 'monthly';
    const hasActiveSubscription =
      church.subscriptionStatus === SubscriptionStatus.active &&
      Boolean(church.stripeSubscriptionId);

    const currentPrice =
      displayInterval === 'yearly'
        ? currentTier.yearlyPrice
        : currentTier.monthlyPrice;
    const projectedPrice =
      displayInterval === 'yearly'
        ? projectedTier.yearlyPrice
        : projectedTier.monthlyPrice;

    return {
      crossesTier,
      requiresConfirmation: crossesTier && !acknowledgment,
      currentMemberCount: church.memberCount,
      projectedMemberCount,
      currentTierId,
      projectedTierId,
      currentTierName: currentTier.name,
      projectedTierName: projectedTier.name,
      currentTierMemberRange: currentTier.memberRange,
      projectedTierMemberRange: projectedTier.memberRange,
      hasActiveSubscription,
      interval,
      currentPrice,
      projectedPrice,
      priceDelta: projectedPrice - currentPrice,
    };
  }

  async confirmTierCrossing(
    churchId: string,
    userId: string,
    targetTierId: BillingTierId,
  ): Promise<ConfirmTierCrossingResult> {
    const church = await this.prisma.church.findUnique({
      where: { id: churchId },
      select: { memberCount: true },
    });

    if (!church) {
      throw new NotFoundException('Igreja não encontrada.');
    }

    const currentTierId = billingTierFromMemberCount(church.memberCount);

    if (!isBillingTierUpgrade(currentTierId, targetTierId)) {
      throw new BadRequestException(
        'Esta faixa não corresponde a um upgrade de cobrança neste momento.',
      );
    }

    await this.prisma.billingTierUpgradeAcknowledgment.upsert({
      where: {
        churchId_tierId: {
          churchId,
          tierId: targetTierId,
        },
      },
      create: {
        churchId,
        tierId: targetTierId,
        userId,
      },
      update: {},
    });

    return {
      acknowledged: true,
      projectedTierId: targetTierId,
    };
  }

  /**
   * Bloqueia create/update/receive que aumentariam ativos cruzando faixa
   * sem acknowledgment prévio.
   */
  async assertActiveMemberIncreaseAllowed(
    churchId: string,
    projectedActiveCount: number,
    churchSnapshot?: TierCrossingChurchSnapshot,
  ): Promise<void> {
    const preview = await this.previewTierCrossing(
      churchId,
      projectedActiveCount,
      churchSnapshot,
    );

    if (!preview.requiresConfirmation) {
      return;
    }

    throw new HttpException(
      {
        code: 'TIER_UPGRADE_REQUIRED',
        message:
          'Esta ação muda a faixa de cobrança da igreja e precisa de autorização do proprietário.',
        ...preview,
      },
      HttpStatus.CONFLICT,
    );
  }

  async requestTierCrossing(
    churchId: string,
    userId: string,
    targetTierId: BillingTierId,
  ): Promise<TierCrossingRequestResult> {
    const church = await this.prisma.church.findUnique({
      where: { id: churchId },
      select: {
        memberCount: true,
        subscriptionStatus: true,
        stripeSubscriptionId: true,
        stripePriceId: true,
      },
    });

    if (!church) {
      throw new NotFoundException('Igreja não encontrada.');
    }

    const currentTierId = billingTierFromMemberCount(church.memberCount);

    if (!isBillingTierUpgrade(currentTierId, targetTierId)) {
      throw new BadRequestException(
        'Esta faixa não corresponde a um upgrade de cobrança neste momento.',
      );
    }

    const acknowledgment =
      await this.prisma.billingTierUpgradeAcknowledgment.findUnique({
        where: {
          churchId_tierId: { churchId, tierId: targetTierId },
        },
      });

    if (acknowledgment) {
      throw new ConflictException(
        'Esta faixa já foi autorizada. Tente adicionar o membro novamente.',
      );
    }

    const existing = await this.prisma.billingTierUpgradeRequest.findUnique({
      where: {
        churchId_targetTierId: { churchId, targetTierId },
      },
    });

    const wasPending = existing?.status === BillingTierUpgradeRequestStatus.pending;
    let emailSent = false;

    const request = await this.prisma.billingTierUpgradeRequest.upsert({
      where: {
        churchId_targetTierId: { churchId, targetTierId },
      },
      create: {
        churchId,
        targetTierId,
        requestedByUserId: userId,
        status: BillingTierUpgradeRequestStatus.pending,
      },
      update: {
        requestedByUserId: userId,
        status: BillingTierUpgradeRequestStatus.pending,
        resolvedAt: null,
        resolvedByUserId: null,
      },
      include: {
        requestedBy: { select: { name: true } },
      },
    });

    if (!wasPending) {
      emailSent = await this.notifyOwnerTierUpgradeRequest(churchId, {
        requesterName: request.requestedBy.name,
        currentTierId,
        targetTierId,
      });
    }

    const currentTier = getBillingTierCatalogEntry(currentTierId);
    const projectedTier = getBillingTierCatalogEntry(targetTierId);
    const priceMatch = church.stripePriceId
      ? this.resolveTierAndIntervalFromPriceId(church.stripePriceId)
      : null;
    const interval = priceMatch?.interval ?? null;
    const displayInterval: BillingInterval = interval ?? 'monthly';

    return {
      id: request.id,
      status: request.status,
      targetTierId,
      currentTierId,
      currentTierName: currentTier.name,
      projectedTierName: projectedTier.name,
      currentTierMemberRange: currentTier.memberRange,
      projectedTierMemberRange: projectedTier.memberRange,
      currentPrice:
        displayInterval === 'yearly'
          ? currentTier.yearlyPrice
          : currentTier.monthlyPrice,
      projectedPrice:
        displayInterval === 'yearly'
          ? projectedTier.yearlyPrice
          : projectedTier.monthlyPrice,
      interval,
      hasActiveSubscription:
        church.subscriptionStatus === SubscriptionStatus.active &&
        Boolean(church.stripeSubscriptionId),
      emailSent,
      requestedByName: request.requestedBy.name,
    };
  }

  async getPendingTierCrossingRequest(
    churchId: string,
  ): Promise<TierCrossingRequestResult | null> {
    const request = await this.prisma.billingTierUpgradeRequest.findFirst({
      where: {
        churchId,
        status: BillingTierUpgradeRequestStatus.pending,
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        requestedBy: { select: { name: true } },
      },
    });

    if (!request) {
      return null;
    }

    const church = await this.prisma.church.findUnique({
      where: { id: churchId },
      select: {
        memberCount: true,
        subscriptionStatus: true,
        stripeSubscriptionId: true,
        stripePriceId: true,
      },
    });

    if (!church) {
      throw new NotFoundException('Igreja não encontrada.');
    }

    const currentTierId = billingTierFromMemberCount(church.memberCount);
    const targetTierId = request.targetTierId as BillingTierId;
    const currentTier = getBillingTierCatalogEntry(currentTierId);
    const projectedTier = getBillingTierCatalogEntry(targetTierId);
    const priceMatch = church.stripePriceId
      ? this.resolveTierAndIntervalFromPriceId(church.stripePriceId)
      : null;
    const interval = priceMatch?.interval ?? null;
    const displayInterval: BillingInterval = interval ?? 'monthly';

    return {
      id: request.id,
      status: request.status,
      targetTierId,
      currentTierId,
      currentTierName: currentTier.name,
      projectedTierName: projectedTier.name,
      currentTierMemberRange: currentTier.memberRange,
      projectedTierMemberRange: projectedTier.memberRange,
      currentPrice:
        displayInterval === 'yearly'
          ? currentTier.yearlyPrice
          : currentTier.monthlyPrice,
      projectedPrice:
        displayInterval === 'yearly'
          ? projectedTier.yearlyPrice
          : projectedTier.monthlyPrice,
      interval,
      hasActiveSubscription:
        church.subscriptionStatus === SubscriptionStatus.active &&
        Boolean(church.stripeSubscriptionId),
      emailSent: false,
      requestedByName: request.requestedBy.name,
    };
  }

  async approveTierCrossingRequest(
    churchId: string,
    ownerUserId: string,
    targetTierId: BillingTierId,
  ): Promise<ConfirmTierCrossingResult> {
    const request = await this.prisma.billingTierUpgradeRequest.findUnique({
      where: {
        churchId_targetTierId: { churchId, targetTierId },
      },
    });

    if (!request || request.status !== BillingTierUpgradeRequestStatus.pending) {
      throw new NotFoundException(
        'Não há pedido pendente para esta faixa de cobrança.',
      );
    }

    const result = await this.confirmTierCrossing(
      churchId,
      ownerUserId,
      targetTierId,
    );

    await this.prisma.billingTierUpgradeRequest.update({
      where: { id: request.id },
      data: {
        status: BillingTierUpgradeRequestStatus.approved,
        resolvedAt: new Date(),
        resolvedByUserId: ownerUserId,
      },
    });

    await this.prisma.billingTierUpgradeStaffNotice.create({
      data: {
        churchId,
        tierId: targetTierId,
      },
    });

    return result;
  }

  async dismissTierCrossingRequest(
    churchId: string,
    ownerUserId: string,
    targetTierId: BillingTierId,
  ): Promise<{ dismissed: true }> {
    const request = await this.prisma.billingTierUpgradeRequest.findUnique({
      where: {
        churchId_targetTierId: { churchId, targetTierId },
      },
    });

    if (!request || request.status !== BillingTierUpgradeRequestStatus.pending) {
      throw new NotFoundException(
        'Não há pedido pendente para esta faixa de cobrança.',
      );
    }

    await this.prisma.billingTierUpgradeRequest.update({
      where: { id: request.id },
      data: {
        status: BillingTierUpgradeRequestStatus.dismissed,
        resolvedAt: new Date(),
        resolvedByUserId: ownerUserId,
      },
    });

    return { dismissed: true };
  }

  async listUnreadStaffNotices(
    churchId: string,
    userId: string,
  ): Promise<TierCrossingStaffNoticeResult[]> {
    const canManage = await this.churchPermissions.hasPermission(
      userId,
      churchId,
      ChurchPermission.members_manage,
    );

    if (!canManage) {
      return [];
    }

    const notices = await this.prisma.billingTierUpgradeStaffNotice.findMany({
      where: {
        churchId,
        reads: {
          none: { userId },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return notices.map((notice) => {
      const tierId = notice.tierId as BillingTierId;
      const tier = getBillingTierCatalogEntry(tierId);

      return {
        id: notice.id,
        tierId,
        tierName: tier.name,
        createdAt: notice.createdAt.toISOString(),
      };
    });
  }

  async markStaffNoticeRead(
    churchId: string,
    userId: string,
    noticeId: string,
  ): Promise<{ read: true }> {
    const notice = await this.prisma.billingTierUpgradeStaffNotice.findFirst({
      where: { id: noticeId, churchId },
    });

    if (!notice) {
      throw new NotFoundException('Aviso não encontrado.');
    }

    await this.prisma.billingTierUpgradeStaffNoticeRead.upsert({
      where: {
        noticeId_userId: { noticeId, userId },
      },
      create: { noticeId, userId },
      update: {},
    });

    return { read: true };
  }

  async syncSubscriptionTierForMemberCount(churchId: string): Promise<void> {
    const church = await this.prisma.church.findUnique({
      where: { id: churchId },
      select: {
        memberCount: true,
        subscriptionStatus: true,
        stripeSubscriptionId: true,
        stripePriceId: true,
      },
    });

    if (
      !church?.stripeSubscriptionId ||
      church.subscriptionStatus !== SubscriptionStatus.active
    ) {
      return;
    }

    const targetTierId = billingTierFromMemberCount(church.memberCount);
    const subscribedTier = church.stripePriceId
      ? this.resolveTierAndIntervalFromPriceId(church.stripePriceId)?.tierId
      : null;

    if (
      !subscribedTier ||
      !isBillingTierUpgrade(subscribedTier, targetTierId)
    ) {
      return;
    }

    const acknowledgment =
      await this.prisma.billingTierUpgradeAcknowledgment.findUnique({
        where: {
          churchId_tierId: {
            churchId,
            tierId: targetTierId,
          },
        },
      });

    if (!acknowledgment) {
      this.logger.warn(
        `Upgrade Stripe bloqueado sem ack para igreja ${churchId} → ${targetTierId}.`,
      );
      return;
    }

    try {
      await this.upgradeSubscriptionTier(churchId, targetTierId);
    } catch (error) {
      this.logger.warn(
        `Falha ao sincronizar faixa Stripe para igreja ${churchId}: ${
          error instanceof Error ? error.message : 'erro desconhecido'
        }`,
      );
    }
  }

  private async notifyOwnerTierUpgradeRequest(
    churchId: string,
    details: {
      requesterName: string;
      currentTierId: BillingTierId;
      targetTierId: BillingTierId;
    },
  ): Promise<boolean> {
    const target = await this.getChurchOwnerNotificationTarget(churchId);

    if (!target) {
      return false;
    }

    const currentTier = getBillingTierCatalogEntry(details.currentTierId);
    const projectedTier = getBillingTierCatalogEntry(details.targetTierId);

    try {
      await this.emailService.sendTierUpgradeRequestEmail(target.email, {
        ownerName: target.ownerName,
        churchName: target.churchName,
        appUrl: target.appUrl,
        settingsUrl: target.settingsUrl,
        requesterName: details.requesterName,
        currentTierName: currentTier.name,
        projectedTierName: projectedTier.name,
      });
      return true;
    } catch (error) {
      this.logger.warn(
        `Falha ao enviar e-mail de pedido de faixa (${churchId}): ${
          error instanceof Error ? error.message : 'erro desconhecido'
        }`,
      );
      return false;
    }
  }

  async upgradeSubscriptionTier(
    churchId: string,
    targetTierId: BillingTierId,
  ): Promise<void> {
    this.assertStripeConfigured();

    const church = await this.prisma.church.findUnique({
      where: { id: churchId },
      select: {
        stripeSubscriptionId: true,
        stripePriceId: true,
        subscriptionStatus: true,
      },
    });

    if (!church?.stripeSubscriptionId) {
      throw new BadRequestException(
        'Esta igreja não possui assinatura ativa para atualizar.',
      );
    }

    if (church.subscriptionStatus !== SubscriptionStatus.active) {
      throw new BadRequestException(
        'A assinatura precisa estar ativa para mudar de faixa.',
      );
    }

    const priceMatch = church.stripePriceId
      ? this.resolveTierAndIntervalFromPriceId(church.stripePriceId)
      : null;
    const interval = priceMatch?.interval ?? 'monthly';
    const newPriceId = this.resolveStripePriceId(targetTierId, interval);

    const subscription = await this.stripe.subscriptions.retrieve(
      church.stripeSubscriptionId,
    );
    const itemId = subscription.items.data[0]?.id;

    if (!itemId) {
      throw new BadRequestException(
        'Não foi possível localizar o item da assinatura no Stripe.',
      );
    }

    const updated = await this.stripe.subscriptions.update(
      church.stripeSubscriptionId,
      {
        items: [{ id: itemId, price: newPriceId }],
        proration_behavior: 'create_prorations',
        metadata: {
          ...subscription.metadata,
          churchId,
          tierId: targetTierId,
        },
      },
    );

    await this.syncSubscriptionToChurch(churchId, updated);
  }

  async createPortalSession(churchId: string): Promise<{ url: string }> {
    this.assertStripeConfigured();

    const church = await this.prisma.church.findUnique({
      where: { id: churchId },
      select: { id: true, name: true, stripeCustomerId: true },
    });

    if (!church) {
      throw new NotFoundException('Igreja não encontrada.');
    }

    const customerId = await this.getOrCreateStripeCustomer(
      church.id,
      church.name,
    );
    const appUrl = this.configService.getOrThrow<string>('appUrl');

    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appUrl}/app/configuracoes?section=subscription`,
      locale: 'pt-BR',
    });

    if (!session.url) {
      throw new BadRequestException(
        'Não foi possível abrir a gestão de assinatura. Tente novamente.',
      );
    }

    return { url: session.url };
  }

  async listInvoices(churchId: string): Promise<BillingInvoiceResult[]> {
    const church = await this.prisma.church.findUnique({
      where: { id: churchId },
      select: { stripeCustomerId: true },
    });

    if (!church) {
      throw new NotFoundException('Igreja não encontrada.');
    }

    if (!church.stripeCustomerId) {
      return [];
    }

    const secretKey = this.configService.get<string>('stripe.secretKey');

    if (!secretKey) {
      return [];
    }

    await this.ensureStripeCustomerLocale(church.stripeCustomerId);

    const invoices = await this.stripe.invoices.list({
      customer: church.stripeCustomerId,
      limit: 24,
    });

    return invoices.data.map((invoice) => this.toBillingInvoiceResult(invoice));
  }

  async handleWebhook(rawBody: Buffer, signature: string | undefined) {
    this.assertStripeConfigured();

    const webhookSecret = this.configService.getOrThrow<string>(
      'stripe.webhookSecret',
    );

    if (!signature) {
      throw new BadRequestException('Assinatura Stripe ausente.');
    }

    let event: Stripe.Event;

    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        webhookSecret,
      );
    } catch (error) {
      this.logger.warn(
        `Webhook Stripe inválido: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
      );
      throw new BadRequestException('Assinatura do webhook inválida.');
    }

    const alreadyProcessed = await this.prisma.stripeWebhookEvent.findUnique({
      where: { id: event.id },
    });

    if (alreadyProcessed) {
      return { received: true, duplicate: true };
    }

    await this.dispatchWebhookEvent(event);

    await this.prisma.stripeWebhookEvent.create({
      data: { id: event.id },
    });

    return { received: true };
  }

  private async dispatchWebhookEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'checkout.session.completed':
        await this.onCheckoutSessionCompleted(event.data.object);
        break;
      case 'customer.subscription.updated':
        await this.onSubscriptionUpdated(event.data.object);
        break;
      case 'customer.subscription.deleted':
        await this.onSubscriptionDeleted(event.data.object);
        break;
      case 'invoice.payment_failed':
        await this.onInvoicePaymentFailed(event.data.object);
        break;
      default:
        break;
    }
  }

  private assertCanStartCheckout(church: {
    subscriptionStatus: SubscriptionStatus;
    stripeSubscriptionId: string | null;
  }): void {
    if (
      church.subscriptionStatus === SubscriptionStatus.active &&
      church.stripeSubscriptionId
    ) {
      throw new ConflictException(
        'Esta igreja já possui uma assinatura ativa. Use a gestão de assinatura para alterar o plano.',
      );
    }

    if (church.subscriptionStatus === SubscriptionStatus.past_due) {
      throw new ConflictException(
        'Há um problema com o pagamento da assinatura. Atualize a forma de pagamento antes de iniciar um novo checkout.',
      );
    }
  }

  private resolveInvoiceSubscriptionId(
    invoice: Stripe.Invoice,
  ): string | null {
    const legacySubscription = (
      invoice as Stripe.Invoice & {
        subscription?: string | Stripe.Subscription | null;
      }
    ).subscription;

    if (typeof legacySubscription === 'string') {
      return legacySubscription;
    }

    if (legacySubscription && typeof legacySubscription === 'object') {
      return legacySubscription.id;
    }

    const subscriptionDetails =
      invoice.parent?.subscription_details?.subscription;

    if (typeof subscriptionDetails === 'string') {
      return subscriptionDetails;
    }

    if (subscriptionDetails && typeof subscriptionDetails === 'object') {
      return subscriptionDetails.id;
    }

    return null;
  }

  private async onInvoicePaymentFailed(
    invoice: Stripe.Invoice,
  ): Promise<void> {
    const subscriptionId = this.resolveInvoiceSubscriptionId(invoice);

    if (!subscriptionId) {
      this.logger.warn(
        'invoice.payment_failed sem assinatura vinculada — evento ignorado.',
      );
      return;
    }

    const subscription =
      await this.stripe.subscriptions.retrieve(subscriptionId);
    const churchId = subscription.metadata?.churchId;

    if (!churchId) {
      this.logger.warn(
        `invoice.payment_failed sem churchId na assinatura ${subscriptionId}.`,
      );
      return;
    }

    await this.syncSubscriptionToChurch(churchId, subscription);
    await this.notifyPaymentFailed(churchId);
  }

  private async onCheckoutSessionCompleted(
    session: Stripe.Checkout.Session,
  ): Promise<void> {
    await this.syncFromCompletedCheckoutSession(session);

    const churchId = session.metadata?.churchId;

    if (!churchId || session.mode !== 'subscription') {
      return;
    }

    const tierId = session.metadata?.tierId as BillingTierId | undefined;
    const interval =
      session.metadata?.interval === 'yearly' ? 'yearly' : 'monthly';
    const tier = tierId ? getBillingTierCatalogEntry(tierId) : null;
    const amount =
      interval === 'yearly' ? tier?.yearlyPrice : tier?.monthlyPrice;
    const intervalLabel = interval === 'yearly' ? 'Anual' : 'Mensal';
    const amountLabel =
      amount != null
        ? new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL',
          }).format(amount) + (interval === 'yearly' ? '/ano' : '/mês')
        : undefined;

    await this.notifySubscriptionConfirmed(churchId, {
      tierName: tier?.name,
      intervalLabel,
      amountLabel,
    });
  }

  private async syncFromCompletedCheckoutSession(
    session: Stripe.Checkout.Session,
  ): Promise<void> {
    const churchId = session.metadata?.churchId;

    if (!churchId) {
      throw new BadRequestException(
        'Sessão de checkout sem igreja nos metadados.',
      );
    }

    const subscriptionId =
      typeof session.subscription === 'string'
        ? session.subscription
        : session.subscription?.id;

    if (!subscriptionId) {
      throw new BadRequestException(
        'Assinatura ainda não disponível na sessão de checkout.',
      );
    }

    const subscription =
      typeof session.subscription === 'object' && session.subscription !== null
        ? session.subscription
        : await this.stripe.subscriptions.retrieve(subscriptionId);

    await this.syncSubscriptionToChurch(churchId, subscription);
  }

  private async onSubscriptionUpdated(
    subscription: Stripe.Subscription,
  ): Promise<void> {
    const churchId = subscription.metadata?.churchId;

    if (!churchId) {
      return;
    }

    const existing = await this.prisma.church.findUnique({
      where: { id: churchId },
      select: { cancelAtPeriodEnd: true },
    });

    if (!existing) {
      return;
    }

    const schedule = this.readStripeSubscriptionSchedule(subscription);
    const wasCancelScheduled = existing.cancelAtPeriodEnd;
    const isCancelScheduled = schedule.cancelAtPeriodEnd;

    await this.syncSubscriptionToChurch(churchId, subscription);

    if (!wasCancelScheduled && isCancelScheduled) {
      await this.notifySubscriptionCancelScheduled(
        churchId,
        schedule.currentPeriodEnd,
      );
    }
  }

  private async onSubscriptionDeleted(
    subscription: Stripe.Subscription,
  ): Promise<void> {
    const churchId = subscription.metadata?.churchId;

    if (!churchId) {
      return;
    }

    await this.prisma.church.update({
      where: { id: churchId },
      data: {
        subscriptionStatus: SubscriptionStatus.canceled,
        stripeSubscriptionId: null,
        stripePriceId: null,
        cancelAtPeriodEnd: false,
      },
    });

    await this.notifySubscriptionCanceled(churchId);
  }

  private async syncSubscriptionToChurch(
    churchId: string,
    subscription: Stripe.Subscription,
  ): Promise<void> {
    const priceId = subscription.items.data[0]?.price.id ?? null;
    const subscriptionStatus = this.mapStripeStatus(subscription.status);
    const schedule = this.readStripeSubscriptionSchedule(subscription);

    await this.prisma.church.update({
      where: { id: churchId },
      data: {
        subscriptionStatus,
        stripeSubscriptionId: subscription.id,
        stripePriceId: priceId,
        cancelAtPeriodEnd: schedule.cancelAtPeriodEnd,
      },
    });
  }

  private readStripeSubscriptionSchedule(subscription: Stripe.Subscription): {
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd: string | null;
    canceledAt: string | null;
  } {
    const subscriptionRecord = subscription as Stripe.Subscription & {
      current_period_end?: number;
    };

    const itemPeriodEnd = subscription.items.data[0]?.current_period_end;
    const cancelAtUnix =
      typeof subscription.cancel_at === 'number' ? subscription.cancel_at : null;
    const periodEndUnix =
      typeof subscriptionRecord.current_period_end === 'number'
        ? subscriptionRecord.current_period_end
        : typeof itemPeriodEnd === 'number'
          ? itemPeriodEnd
          : cancelAtUnix;

    const cancelScheduled =
      Boolean(subscription.cancel_at_period_end) ||
      (subscription.status === 'active' && cancelAtUnix !== null) ||
      (subscription.status === 'active' &&
        typeof subscription.canceled_at === 'number');

    return {
      cancelAtPeriodEnd: cancelScheduled,
      currentPeriodEnd:
        periodEndUnix !== null
          ? new Date(periodEndUnix * 1000).toISOString()
          : null,
      canceledAt:
        typeof subscription.canceled_at === 'number'
          ? new Date(subscription.canceled_at * 1000).toISOString()
          : null,
    };
  }

  private mapStripeStatus(
    status: Stripe.Subscription.Status,
  ): SubscriptionStatus {
    switch (status) {
      case 'active':
      case 'trialing':
        return SubscriptionStatus.active;
      case 'past_due':
      case 'unpaid':
        return SubscriptionStatus.past_due;
      case 'canceled':
      case 'incomplete_expired':
        return SubscriptionStatus.canceled;
      default:
        return SubscriptionStatus.past_due;
    }
  }

  private async getOrCreateStripeCustomer(
    churchId: string,
    churchName: string,
  ): Promise<string> {
    const church = await this.prisma.church.findUnique({
      where: { id: churchId },
      select: { stripeCustomerId: true },
    });

    if (church?.stripeCustomerId) {
      await this.ensureStripeCustomerLocale(church.stripeCustomerId);
      return church.stripeCustomerId;
    }

    const customer = await this.stripe.customers.create({
      name: churchName,
      metadata: { churchId },
      preferred_locales: ['pt-BR'],
    });

    await this.prisma.church.update({
      where: { id: churchId },
      data: { stripeCustomerId: customer.id },
    });

    return customer.id;
  }

  private async ensureStripeCustomerLocale(customerId: string): Promise<void> {
    try {
      await this.stripe.customers.update(customerId, {
        preferred_locales: ['pt-BR'],
      });
    } catch (error) {
      this.logger.warn(
        `Falha ao definir locale pt-BR no cliente Stripe ${customerId}: ${
          error instanceof Error ? error.message : 'erro desconhecido'
        }`,
      );
    }
  }

  private localizeStripeHostedUrl(
    url: string | null | undefined,
    locale = 'pt-BR',
  ): string | null {
    if (!url) {
      return null;
    }

    try {
      const parsed = new URL(url);
      parsed.searchParams.set('locale', locale);
      return parsed.toString();
    } catch {
      return url;
    }
  }

  private resolveTierAndIntervalFromPriceId(
    priceId: string,
  ): { tierId: BillingTierId; interval: BillingInterval } | null {
    const prices = this.configService.get<Record<
      BillingTierId,
      { monthly: string; yearly: string }
    >>('stripe.prices');

    if (!prices) {
      return null;
    }

    for (const tierId of BILLING_TIER_IDS) {
      for (const interval of ['monthly', 'yearly'] as const) {
        if (prices[tierId]?.[interval] === priceId) {
          return { tierId, interval };
        }
      }
    }

    return null;
  }

  private resolveStripePriceId(
    tierId: BillingTierId,
    interval: BillingInterval,
  ): string {
    const prices = this.configService.get<Record<
      BillingTierId,
      { monthly: string; yearly: string }
    >>('stripe.prices');
    const priceId = prices?.[tierId]?.[interval];

    if (!priceId) {
      throw new BadRequestException(
        `Preço Stripe não configurado para a faixa ${tierId} (${interval}).`,
      );
    }

    return priceId;
  }

  private assertStripeConfigured(): void {
    const secretKey = this.configService.get<string>('stripe.secretKey');

    if (!secretKey) {
      throw new BadRequestException(
        'Pagamentos ainda não configurados no servidor.',
      );
    }
  }

  private toBillingInvoiceResult(
    invoice: Stripe.Invoice,
  ): BillingInvoiceResult {
    return {
      id: invoice.id,
      number: invoice.number,
      status: invoice.status ?? 'unknown',
      amountPaid: invoice.amount_paid,
      currency: invoice.currency,
      createdAt: new Date(invoice.created * 1000).toISOString(),
      periodStart:
        invoice.period_start != null
          ? new Date(invoice.period_start * 1000).toISOString()
          : null,
      periodEnd:
        invoice.period_end != null
          ? new Date(invoice.period_end * 1000).toISOString()
          : null,
      hostedInvoiceUrl: this.localizeStripeHostedUrl(
        invoice.hosted_invoice_url,
      ),
      invoicePdf: invoice.invoice_pdf ?? null,
    };
  }

  private async notifySubscriptionConfirmed(
    churchId: string,
    details: {
      tierName?: string;
      intervalLabel?: string;
      amountLabel?: string;
    },
  ): Promise<void> {
    const target = await this.getChurchOwnerNotificationTarget(churchId);

    if (!target) {
      return;
    }

    try {
      await this.emailService.sendSubscriptionConfirmedEmail(target.email, {
        ownerName: target.ownerName,
        churchName: target.churchName,
        appUrl: target.appUrl,
        settingsUrl: target.settingsUrl,
        tierName: details.tierName,
        intervalLabel: details.intervalLabel,
        amountLabel: details.amountLabel,
      });
    } catch (error) {
      this.logger.warn(
        `Falha ao enviar e-mail de assinatura confirmada (${churchId}): ${
          error instanceof Error ? error.message : 'erro desconhecido'
        }`,
      );
    }
  }

  private async notifyPaymentFailed(churchId: string): Promise<void> {
    const target = await this.getChurchOwnerNotificationTarget(churchId);

    if (!target) {
      return;
    }

    try {
      await this.emailService.sendPaymentFailedEmail(target.email, {
        ownerName: target.ownerName,
        churchName: target.churchName,
        appUrl: target.appUrl,
        settingsUrl: target.settingsUrl,
      });
    } catch (error) {
      this.logger.warn(
        `Falha ao enviar e-mail de pagamento recusado (${churchId}): ${
          error instanceof Error ? error.message : 'erro desconhecido'
        }`,
      );
    }
  }

  private async notifySubscriptionCanceled(churchId: string): Promise<void> {
    const target = await this.getChurchOwnerNotificationTarget(churchId);

    if (!target) {
      return;
    }

    try {
      await this.emailService.sendSubscriptionCanceledEmail(target.email, {
        ownerName: target.ownerName,
        churchName: target.churchName,
        appUrl: target.appUrl,
        settingsUrl: target.settingsUrl,
      });
    } catch (error) {
      this.logger.warn(
        `Falha ao enviar e-mail de cancelamento (${churchId}): ${
          error instanceof Error ? error.message : 'erro desconhecido'
        }`,
      );
    }
  }

  private async notifySubscriptionCancelScheduled(
    churchId: string,
    currentPeriodEnd: string | null,
  ): Promise<void> {
    const target = await this.getChurchOwnerNotificationTarget(churchId);

    if (!target) {
      return;
    }

    const accessEndsAtLabel = currentPeriodEnd
      ? new Date(currentPeriodEnd).toLocaleDateString('pt-BR', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
          timeZone: 'America/Sao_Paulo',
        })
      : undefined;

    try {
      await this.emailService.sendSubscriptionCancelScheduledEmail(
        target.email,
        {
          ownerName: target.ownerName,
          churchName: target.churchName,
          appUrl: target.appUrl,
          settingsUrl: target.settingsUrl,
          accessEndsAtLabel,
        },
      );
    } catch (error) {
      this.logger.warn(
        `Falha ao enviar e-mail de cancelamento agendado (${churchId}): ${
          error instanceof Error ? error.message : 'erro desconhecido'
        }`,
      );
    }
  }

  private async getChurchOwnerNotificationTarget(churchId: string): Promise<{
    email: string;
    ownerName: string;
    churchName: string;
    appUrl: string;
    settingsUrl: string;
  } | null> {
    const [church, ownerMembership] = await Promise.all([
      this.prisma.church.findUnique({
        where: { id: churchId },
        select: { name: true },
      }),
      this.prisma.churchMembership.findFirst({
        where: { churchId, isOwner: true },
        include: {
          user: {
            select: {
              name: true,
              email: true,
              memberProfiles: {
                where: { churchId, deletedAt: null },
                select: { email: true },
                take: 1,
              },
            },
          },
        },
      }),
    ]);

    if (!church || !ownerMembership) {
      return null;
    }

    const memberProfileEmail =
      ownerMembership.user.memberProfiles[0]?.email ?? null;
    const email = resolveUserContactEmail(
      ownerMembership.user.email,
      memberProfileEmail,
    );

    if (!email) {
      return null;
    }

    const appUrl = this.configService.getOrThrow<string>('appUrl');

    return {
      email,
      ownerName: ownerMembership.user.name,
      churchName: church.name,
      appUrl,
      settingsUrl: `${appUrl}/app/configuracoes?section=subscription`,
    };
  }
}
