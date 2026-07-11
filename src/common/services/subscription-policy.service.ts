import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SubscriptionStatus, type Church } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';

export interface ChurchSubscriptionSummary {
  subscriptionStatus: SubscriptionStatus;
  trialEndsAt: string | null;
  trialDaysRemaining: number | null;
  featuresLocked: boolean;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class SubscriptionPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  isTrialEnforcementEnabled(): boolean {
    return this.configService.get<boolean>('trial.enforcement') ?? false;
  }

  buildSummary(church: Pick<
    Church,
    'subscriptionStatus' | 'trialEndsAt'
  >): ChurchSubscriptionSummary {
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
    };
  }

  isFeaturesLocked(
    church: Pick<Church, 'subscriptionStatus' | 'trialEndsAt'>,
  ): boolean {
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

    if (this.isFeaturesLocked(church)) {
      throw new ForbiddenException(
        'Seu período de teste terminou. Assine para continuar editando.',
      );
    }
  }
}
