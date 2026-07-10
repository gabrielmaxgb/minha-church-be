import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SubscriptionStatus } from '@prisma/client';
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
import { SubscriptionPolicyService } from '../../common/services/subscription-policy.service';
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

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly stripe: Stripe;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly subscriptionPolicy: SubscriptionPolicyService,
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
  ): Promise<TierCrossingPreviewResult> {
    if (!Number.isInteger(projectedMemberCount) || projectedMemberCount < 0) {
      throw new BadRequestException('Quantidade de membros inválida.');
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
        await this.syncFromCompletedCheckoutSession(event.data.object);
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

    await this.syncSubscriptionToChurch(churchId, subscription);
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
      },
    });
  }

  private async syncSubscriptionToChurch(
    churchId: string,
    subscription: Stripe.Subscription,
  ): Promise<void> {
    const priceId = subscription.items.data[0]?.price.id ?? null;
    const subscriptionStatus = this.mapStripeStatus(subscription.status);

    await this.prisma.church.update({
      where: { id: churchId },
      data: {
        subscriptionStatus,
        stripeSubscriptionId: subscription.id,
        stripePriceId: priceId,
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
}
