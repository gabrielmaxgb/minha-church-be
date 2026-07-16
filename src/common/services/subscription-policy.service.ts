import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SubscriptionStatus, type Church } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';

export type SubscriptionLockReason = 'trial_expired' | 'past_due' | 'canceled';

export interface ChurchSubscriptionSummary {
  subscriptionStatus: SubscriptionStatus;
  trialEndsAt: string | null;
  trialDaysRemaining: number | null;
  featuresLocked: boolean;
  lockReason: SubscriptionLockReason | null;
}

/** Igreja mínima que a política precisa para decidir acesso. */
type ChurchPolicyInput = Pick<
  Church,
  'subscriptionStatus' | 'trialEndsAt'
> &
  Partial<Pick<Church, 'pastDueSince'>>;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const LOCK_MESSAGES: Record<SubscriptionLockReason, string> = {
  trial_expired:
    'Seu período de teste terminou. Assine um plano para voltar a editar e usar os recursos premium.',
  past_due:
    'Encontramos um problema no pagamento da sua assinatura. Atualize a forma de pagamento para reativar os recursos.',
  canceled:
    'Sua assinatura foi encerrada. Reative um plano para voltar a usar os recursos premium.',
};

@Injectable()
export class SubscriptionPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  isTrialEnforcementEnabled(): boolean {
    return this.configService.get<boolean>('trial.enforcement') ?? false;
  }

  private pastDueGraceDays(): number {
    return Math.max(
      0,
      this.configService.get<number>('trial.pastDueGraceDays') ?? 7,
    );
  }

  buildSummary(church: ChurchPolicyInput): ChurchSubscriptionSummary {
    const now = Date.now();
    const trialEndsAt = church.trialEndsAt?.toISOString() ?? null;
    const trialDaysRemaining =
      church.subscriptionStatus === SubscriptionStatus.trialing &&
      church.trialEndsAt
        ? Math.max(
            0,
            Math.ceil((church.trialEndsAt.getTime() - now) / MS_PER_DAY),
          )
        : null;

    return {
      subscriptionStatus: church.subscriptionStatus,
      trialEndsAt,
      trialDaysRemaining,
      featuresLocked: this.isFeaturesLocked(church),
      lockReason: this.getLockReason(church),
    };
  }

  isFeaturesLocked(church: ChurchPolicyInput): boolean {
    if (!this.isTrialEnforcementEnabled()) {
      return false;
    }

    if (church.subscriptionStatus === SubscriptionStatus.active) {
      return false;
    }

    if (church.subscriptionStatus === SubscriptionStatus.trialing) {
      if (!church.trialEndsAt) {
        return this.isTrialEnforcementEnabled();
      }

      return church.trialEndsAt.getTime() <= Date.now();
    }

    return true;
  }

  /** Motivo do bloqueio (para copy por status). `null` quando liberado. */
  getLockReason(church: ChurchPolicyInput): SubscriptionLockReason | null {
    if (!this.isFeaturesLocked(church)) {
      return null;
    }

    switch (church.subscriptionStatus) {
      case SubscriptionStatus.past_due:
        return 'past_due';
      case SubscriptionStatus.canceled:
        return 'canceled';
      default:
        return 'trial_expired';
    }
  }

  getLockMessage(reason: SubscriptionLockReason): string {
    return LOCK_MESSAGES[reason];
  }

  /**
   * Página pública de doação (`/doar`). Segue no ar quando a igreja tem direito
   * (active/trial válido) e, em past_due, durante a janela de graça — para não
   * derrubar a doação de um membro por cartão vencido involuntário. canceled e
   * trial expirado nunca têm graça.
   */
  isPublicGivingEntitled(church: ChurchPolicyInput): boolean {
    if (!this.isFeaturesLocked(church)) {
      return true;
    }

    if (
      church.subscriptionStatus === SubscriptionStatus.past_due &&
      church.pastDueSince
    ) {
      const graceMs = this.pastDueGraceDays() * MS_PER_DAY;
      return church.pastDueSince.getTime() + graceMs > Date.now();
    }

    return false;
  }

  async assertCanUseGatedFeature(churchId: string): Promise<void> {
    const church = await this.prisma.church.findUnique({
      where: { id: churchId },
      select: {
        subscriptionStatus: true,
        trialEndsAt: true,
      },
    });

    if (!church) {
      throw new NotFoundException('Igreja não encontrada.');
    }

    const reason = this.getLockReason(church);

    if (reason) {
      throw new ForbiddenException(this.getLockMessage(reason));
    }
  }
}
