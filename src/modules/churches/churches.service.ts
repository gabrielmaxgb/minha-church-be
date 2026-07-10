import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SubscriptionStatus } from '@prisma/client';

import { seedDefaultChurchRoles } from '../../common/permissions/seed-default-church-roles';
import { canonicalizeEmail } from '../../common/utils/canonicalize-email';
import { generateUniqueChurchSlug } from '../../common/utils/church-slug';
import { PrismaService } from '../../database/prisma.service';
import type {
  ChurchRecord,
  RegisterChurchInput,
  RegisterChurchResult,
} from './churches.types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class ChurchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async findById(id: string): Promise<ChurchRecord | null> {
    const church = await this.prisma.church.findUnique({
      where: { id },
    });

    if (!church) {
      return null;
    }

    return this.toChurchRecord(church);
  }

  async findManyByIds(ids: string[]): Promise<ChurchRecord[]> {
    const churches = await this.prisma.church.findMany({
      where: {
        id: {
          in: ids,
        },
      },
    });

    return churches.map((church) => this.toChurchRecord(church));
  }

  async registerChurch(
    input: RegisterChurchInput,
  ): Promise<RegisterChurchResult> {
    const email = input.ownerEmail.trim().toLowerCase();
    const strictGmailAliases = this.configService.get<boolean>(
      'email.strictGmailAliases',
    );
    const emailCanonical = canonicalizeEmail(email, {
      strictGmailAliases,
    });

    const existingUser = await this.prisma.user.findFirst({
      where: {
        OR: [{ email }, { emailCanonical }],
      },
      select: { id: true },
    });

    if (existingUser) {
      throw new ConflictException('E-mail já está em uso.');
    }

    const trialEndsAt = this.computeTrialEndsAt();

    return this.prisma.$transaction(async (tx) => {
      const slug = await generateUniqueChurchSlug(tx, input.churchName);

      const church = await tx.church.create({
        data: {
          name: input.churchName.trim(),
          slug,
          subscriptionStatus: SubscriptionStatus.trialing,
          trialEndsAt,
          memberCount: 0,
        },
      });

      await seedDefaultChurchRoles(tx, church.id);

      const user = await tx.user.create({
        data: {
          email,
          emailCanonical,
          name: input.ownerName.trim(),
          passwordHash: input.passwordHash,
        },
      });

      await tx.churchMembership.create({
        data: {
          userId: user.id,
          churchId: church.id,
          isOwner: true,
        },
      });

      return {
        churchId: church.id,
        userId: user.id,
      };
    });
  }

  computeTrialEndsAt(from: Date = new Date()): Date {
    const durationDays = Math.max(
      1,
      this.configService.get<number>('trial.durationDays') ?? 30,
    );

    return new Date(from.getTime() + durationDays * MS_PER_DAY);
  }

  private toChurchRecord(church: {
    id: string;
    name: string;
    slug: string;
    memberCount: number;
    subscriptionStatus: ChurchRecord['subscriptionStatus'];
    trialEndsAt: Date | null;
  }): ChurchRecord {
    return {
      id: church.id,
      name: church.name,
      slug: church.slug,
      memberCount: church.memberCount,
      subscriptionStatus: church.subscriptionStatus,
      trialEndsAt: church.trialEndsAt,
    };
  }
}
