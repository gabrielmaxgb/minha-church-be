import { Injectable } from '@nestjs/common';
import { MemberStatus } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { toMinistryEventResponse } from '../ministries/ministries.types';
import type { DashboardSummaryResponse } from './dashboard.types';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(churchId: string): Promise<DashboardSummaryResponse> {
    const now = new Date();

    const [memberCount, activeMembers, upcomingEvents, featuredEvents] =
      await Promise.all([
        this.prisma.member.count({
          where: {
            churchId,
            deletedAt: null,
            status: { in: [MemberStatus.active, MemberStatus.visitor] },
          },
        }),
        this.prisma.member.count({
          where: {
            churchId,
            deletedAt: null,
            status: MemberStatus.active,
          },
        }),
        this.prisma.ministryEvent.count({
          where: {
            churchId,
            deletedAt: null,
            startsAt: { gte: now },
          },
        }),
        this.prisma.ministryEvent.findMany({
          where: {
            churchId,
            ministryId: null,
            deletedAt: null,
            startsAt: { gte: now },
          },
          include: { ministry: true },
          orderBy: { startsAt: 'asc' },
          take: 5,
        }),
      ]);

    return {
      memberCount,
      activeMembers,
      upcomingEvents,
      monthlyBalance: 0,
      featuredEvents: featuredEvents.map(toMinistryEventResponse),
    };
  }
}
