import { Injectable } from '@nestjs/common';
import { MemberStatus } from '@prisma/client';

import { ChurchPermissionsService } from '../../common/services/church-permissions.service';
import { PrismaService } from '../../database/prisma.service';
import { buildVisibleEventsWhere } from '../events/event-visibility';
import { toMinistryEventResponse } from '../ministries/ministries.types';
import type { DashboardSummaryResponse } from './dashboard.types';

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly churchPermissions: ChurchPermissionsService,
  ) {}

  async getSummary(
    churchId: string,
    userId: string,
  ): Promise<DashboardSummaryResponse> {
    const now = new Date();
    const visibilityWhere = await buildVisibleEventsWhere(
      this.prisma,
      this.churchPermissions,
      userId,
      churchId,
    );

    const eventWhere = {
      churchId,
      deletedAt: null,
      startsAt: { gte: now },
      ...(visibilityWhere ?? {}),
    };

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
          where: eventWhere,
        }),
        this.prisma.ministryEvent.findMany({
          where: {
            ...eventWhere,
            ministryId: null,
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
