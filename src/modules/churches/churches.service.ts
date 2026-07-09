import { Injectable } from '@nestjs/common';
import type { SubscriptionStatus } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import type { ChurchRecord } from './churches.types';

@Injectable()
export class ChurchesService {
  constructor(private readonly prisma: PrismaService) {}

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

  private toChurchRecord(church: {
    id: string;
    name: string;
    slug: string;
    memberCount: number;
    subscriptionStatus: SubscriptionStatus;
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
