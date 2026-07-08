import { Injectable } from '@nestjs/common';
import { ChurchPermission, MemberStatus } from '@prisma/client';

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
    const [canMembers, canActivities, canFinances] = await Promise.all([
      this.churchPermissions.hasPermission(
        userId,
        churchId,
        ChurchPermission.members_access,
      ),
      this.churchPermissions.hasPermission(
        userId,
        churchId,
        ChurchPermission.activities_access,
      ),
      this.churchPermissions.hasPermission(
        userId,
        churchId,
        ChurchPermission.finances_access,
      ),
    ]);

    const now = new Date();

    const [memberCount, activeMembers] = canMembers
      ? await Promise.all([
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
        ])
      : [null, null];

    let upcomingEvents: number | null = null;
    let featuredEvents: DashboardSummaryResponse['featuredEvents'] = [];

    if (canActivities) {
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

      const [upcomingCount, featured] = await Promise.all([
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

      upcomingEvents = upcomingCount;
      featuredEvents = featured.map(toMinistryEventResponse);
    }

    return {
      memberCount,
      activeMembers,
      upcomingEvents,
      monthlyBalance: canFinances ? 0 : null,
      featuredEvents,
    };
  }
}
