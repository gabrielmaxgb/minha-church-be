import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class OnboardingPolicyService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  isCanonicalEmailEnforced(): boolean {
    return this.config.get<boolean>('onboarding.enforceCanonicalEmail') ?? false;
  }

  isEmailVerificationRequired(): boolean {
    return (
      this.config.get<boolean>('onboarding.emailVerificationRequired') ?? false
    );
  }

  getUnverifiedMemberLimit(): number {
    return this.config.get<number>('onboarding.unverifiedMemberLimit') ?? 5;
  }

  async assertCanAddMember(churchId: string): Promise<void> {
    if (!this.isEmailVerificationRequired()) {
      return;
    }

    const ownerMembership = await this.prisma.churchMembership.findFirst({
      where: { churchId, isOwner: true },
      include: {
        user: {
          select: { emailVerifiedAt: true },
        },
      },
    });

    if (ownerMembership?.user.emailVerifiedAt) {
      return;
    }

    const memberCount = await this.prisma.member.count({
      where: { churchId, deletedAt: null },
    });

    if (memberCount >= this.getUnverifiedMemberLimit()) {
      throw new ForbiddenException(
        'Verifique o e-mail do proprietário para cadastrar mais membros.',
      );
    }
  }
}
