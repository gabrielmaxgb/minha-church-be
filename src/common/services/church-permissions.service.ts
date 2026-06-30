import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service';
import {
  CHURCH_EVENT_MANAGER_ROLES,
  CHURCH_MEMBER_MANAGER_ROLES,
  CHURCH_MINISTRY_MANAGER_ROLES,
} from '../guards/index';
import type { UserPermissions } from '../types/user-permissions';
import type { UserRole } from '../types/user-role';

const FINANCE_ACCESS_ROLES = [
  'owner',
  'admin',
  'pastor',
  'treasurer',
] as const satisfies readonly UserRole[];

const COMMUNICATION_ACCESS_ROLES = [
  'owner',
  'admin',
  'pastor',
  'secretary',
] as const satisfies readonly UserRole[];

const REPORTS_ACCESS_ROLES = [
  'owner',
  'admin',
  'pastor',
  'treasurer',
] as const satisfies readonly UserRole[];

const SETTINGS_ACCESS_ROLES = [
  'owner',
  'admin',
  'pastor',
] as const satisfies readonly UserRole[];

@Injectable()
export class ChurchPermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  isChurchRole(
    role: UserRole | null | undefined,
    allowed: readonly UserRole[],
  ): boolean {
    return role !== null && role !== undefined && allowed.includes(role);
  }

  async getUserPermissions(
    userId: string,
    churchId: string,
    churchRole: UserRole,
  ): Promise<UserPermissions> {
    const canManageMembers = this.isChurchRole(
      churchRole,
      CHURCH_MEMBER_MANAGER_ROLES,
    );
    const canManageMinistries = this.isChurchRole(
      churchRole,
      CHURCH_MINISTRY_MANAGER_ROLES,
    );
    const canManageChurchEvents = this.isChurchRole(
      churchRole,
      CHURCH_EVENT_MANAGER_ROLES,
    );

    let ministryIds: string[] = [];

    if (canManageChurchEvents) {
      const ministries = await this.prisma.ministry.findMany({
        where: { churchId, isActive: true },
        select: { id: true },
      });

      ministryIds = ministries.map((ministry) => ministry.id);
    } else {
      const member = await this.prisma.member.findFirst({
        where: {
          churchId,
          userId,
          deletedAt: null,
        },
        include: {
          ministryLinks: {
            where: {
              endedAt: null,
              ministryRole: {
                canManageEvents: true,
              },
            },
            select: {
              ministryId: true,
            },
          },
        },
      });

      ministryIds =
        member?.ministryLinks.map((link) => link.ministryId) ?? [];
    }

    return {
      members: { manage: canManageMembers },
      ministries: { manage: canManageMinistries },
      activities: {
        createChurchWide: canManageChurchEvents,
        ministryIds,
      },
      finances: {
        access: this.isChurchRole(churchRole, FINANCE_ACCESS_ROLES),
      },
      communication: {
        access: this.isChurchRole(churchRole, COMMUNICATION_ACCESS_ROLES),
      },
      reports: {
        access: this.isChurchRole(churchRole, REPORTS_ACCESS_ROLES),
      },
      settings: {
        access: this.isChurchRole(churchRole, SETTINGS_ACCESS_ROLES),
      },
    };
  }

  async canManageMinistryEvents(
    userId: string,
    churchId: string,
    ministryId: string,
    churchRole: UserRole | null,
  ): Promise<boolean> {
    if (this.isChurchRole(churchRole, CHURCH_EVENT_MANAGER_ROLES)) {
      const ministry = await this.prisma.ministry.findFirst({
        where: { id: ministryId, churchId, isActive: true },
      });

      return ministry !== null;
    }

    const member = await this.prisma.member.findFirst({
      where: {
        churchId,
        userId,
        deletedAt: null,
      },
      include: {
        ministryLinks: {
          where: {
            ministryId,
            endedAt: null,
            ministryRole: {
              canManageEvents: true,
            },
          },
          include: {
            ministryRole: true,
          },
        },
      },
    });

    return (member?.ministryLinks.length ?? 0) > 0;
  }
}
