import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SubscriptionStatus } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TRIAL_DAYS = 30;

/** Mensagem exibida quando o trial expira e o recurso é bloqueado. */
export const TRIAL_FEATURE_LOCKED_MESSAGE =
  'Seu período de teste terminou. Assine um plano para criar novos ministérios, atividades e escalas. O cadastro de membros continua liberado.';

export interface SubscriptionSnapshot {
  status: SubscriptionStatus;
  trialEndsAt: Date | null;
}

export interface SubscriptionState {
  status: SubscriptionStatus;
  trialEndsAt: string | null;
  trialDaysRemaining: number | null;
  hasFullAccess: boolean;
  featuresLocked: boolean;
}

@Injectable()
export class SubscriptionPolicyService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  getTrialDays(): number {
    const value = this.config.get<number>('subscription.trialDays');

    return Number.isFinite(value) && (value ?? 0) > 0
      ? (value as number)
      : DEFAULT_TRIAL_DAYS;
  }

  isEnforced(): boolean {
    return this.config.get<boolean>('subscription.enforcement') ?? false;
  }

  /** Data de término do trial para uma igreja criada agora. */
  buildTrialEndsAt(from = new Date()): Date {
    return new Date(from.getTime() + this.getTrialDays() * DAY_IN_MS);
  }

  /** Avaliação pura (sem I/O) do estado da assinatura de uma igreja. */
  evaluate(snapshot: SubscriptionSnapshot, now = new Date()): SubscriptionState {
    const isActivePlan = snapshot.status === SubscriptionStatus.active;
    const trialEndsAt = snapshot.trialEndsAt;
    const isTrialing = snapshot.status === SubscriptionStatus.trialing;
    const trialValid =
      isTrialing && trialEndsAt !== null && trialEndsAt.getTime() > now.getTime();

    const hasFullAccess = isActivePlan || trialValid;
    const featuresLocked = this.isEnforced() && !hasFullAccess;

    let trialDaysRemaining: number | null = null;

    if (isTrialing && trialEndsAt) {
      const diffMs = trialEndsAt.getTime() - now.getTime();
      trialDaysRemaining = Math.max(0, Math.ceil(diffMs / DAY_IN_MS));
    }

    return {
      status: snapshot.status,
      trialEndsAt: trialEndsAt ? trialEndsAt.toISOString() : null,
      trialDaysRemaining,
      hasFullAccess,
      featuresLocked,
    };
  }

  async getState(churchId: string): Promise<SubscriptionState> {
    const church = await this.prisma.church.findUnique({
      where: { id: churchId },
      select: { subscriptionStatus: true, trialEndsAt: true },
    });

    return this.evaluate({
      status: church?.subscriptionStatus ?? SubscriptionStatus.trialing,
      trialEndsAt: church?.trialEndsAt ?? null,
    });
  }

  /** Bloqueia recursos de crescimento/gestão quando o trial expira. */
  async assertCanUseGatedFeature(churchId: string): Promise<void> {
    if (!this.isEnforced()) {
      return;
    }

    const state = await this.getState(churchId);

    if (state.featuresLocked) {
      throw new ForbiddenException(TRIAL_FEATURE_LOCKED_MESSAGE);
    }
  }
}
