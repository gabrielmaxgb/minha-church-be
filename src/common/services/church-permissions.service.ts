import { Injectable } from '@nestjs/common';
import { ChurchPermission } from '@prisma/client';

import { ALL_CHURCH_PERMISSIONS } from '../permissions/church-permissions.constants';
import { PrismaService } from '../../database/prisma.service';
import type { UserPermissions } from '../types/user-permissions';

export interface ChurchRoleSummary {
  id: string;
  name: string;
  color: string | null;
  sortOrder: number;
  isSystem: boolean;
}

export interface MembershipAccessContext {
  membershipId: string;
  userId: string;
  churchId: string;
  isOwner: boolean;
  roles: ChurchRoleSummary[];
  permissions: Set<ChurchPermission>;
}

const membershipInclude = {
  roleAssignments: {
    include: {
      role: {
        include: {
          permissions: true,
        },
      },
    },
  },
} as const;

@Injectable()
export class ChurchPermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  async getMembershipAccess(
    userId: string,
    churchId: string,
  ): Promise<MembershipAccessContext | null> {
    const membership = await this.prisma.churchMembership.findUnique({
      where: {
        userId_churchId: {
          userId,
          churchId,
        },
      },
      include: membershipInclude,
    });

    if (!membership) {
      return null;
    }

    return this.toAccessContext(membership);
  }

  async hasPermission(
    userId: string,
    churchId: string,
    permission: ChurchPermission,
  ): Promise<boolean> {
    const access = await this.getMembershipAccess(userId, churchId);

    if (!access) {
      return false;
    }

    return access.isOwner || access.permissions.has(permission);
  }

  async hasAnyPermission(
    userId: string,
    churchId: string,
    permissions: readonly ChurchPermission[],
  ): Promise<boolean> {
    const access = await this.getMembershipAccess(userId, churchId);

    if (!access) {
      return false;
    }

    if (access.isOwner) {
      return true;
    }

    return permissions.some((permission) => access.permissions.has(permission));
  }

  async getUserPermissions(
    userId: string,
    churchId: string,
  ): Promise<UserPermissions> {
    const access = await this.getMembershipAccess(userId, churchId);

    if (!access) {
      return this.emptyPermissions();
    }

    const granted = access.isOwner
      ? new Set(ALL_CHURCH_PERMISSIONS)
      : access.permissions;

    const canManageChurchEvents = granted.has(
      ChurchPermission.events_create_church_wide,
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
              roleAssignments: {
                some: {
                  ministryRole: {
                    canManageEvents: true,
                  },
                },
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
      members: { manage: granted.has(ChurchPermission.members_manage) },
      ministries: { manage: granted.has(ChurchPermission.ministries_manage) },
      activities: {
        createChurchWide: canManageChurchEvents,
        ministryIds,
      },
      finances: { access: granted.has(ChurchPermission.finances_access) },
      communication: {
        access: granted.has(ChurchPermission.communication_access),
      },
      reports: { access: granted.has(ChurchPermission.reports_access) },
      settings: { access: granted.has(ChurchPermission.settings_access) },
      roles: { manage: granted.has(ChurchPermission.roles_manage) },
      memberships: {
        manage: granted.has(ChurchPermission.memberships_manage),
      },
    };
  }

  async canManageMinistryEvents(
    userId: string,
    churchId: string,
    ministryId: string,
  ): Promise<boolean> {
    const access = await this.getMembershipAccess(userId, churchId);

    if (!access) {
      return false;
    }

    const canManageChurchEvents =
      access.isOwner ||
      access.permissions.has(ChurchPermission.events_create_church_wide);

    if (canManageChurchEvents) {
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
            roleAssignments: {
              some: {
                ministryRole: {
                  canManageEvents: true,
                },
              },
            },
          },
        },
      },
    });

    return (member?.ministryLinks.length ?? 0) > 0;
  }

  permissionsAreSubsetOf(
    candidate: Iterable<ChurchPermission>,
    actor: Iterable<ChurchPermission>,
  ): boolean {
    const actorSet = new Set(actor);

    for (const permission of candidate) {
      if (!actorSet.has(permission)) {
        return false;
      }
    }

    return true;
  }

  private toAccessContext(membership: {
    id: string;
    userId: string;
    churchId: string;
    isOwner: boolean;
    roleAssignments: Array<{
      role: {
        id: string;
        name: string;
        color: string | null;
        sortOrder: number;
        isSystem: boolean;
        permissions: Array<{ permission: ChurchPermission }>;
      };
    }>;
  }): MembershipAccessContext {
    const roles = membership.roleAssignments
      .map((assignment) => assignment.role)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

    const permissions = new Set<ChurchPermission>();

    for (const role of roles) {
      for (const entry of role.permissions) {
        permissions.add(entry.permission);
      }
    }

    return {
      membershipId: membership.id,
      userId: membership.userId,
      churchId: membership.churchId,
      isOwner: membership.isOwner,
      roles: roles.map((role) => ({
        id: role.id,
        name: role.name,
        color: role.color,
        sortOrder: role.sortOrder,
        isSystem: role.isSystem,
      })),
      permissions,
    };
  }

  private emptyPermissions(): UserPermissions {
    return {
      members: { manage: false },
      ministries: { manage: false },
      activities: { createChurchWide: false, ministryIds: [] },
      finances: { access: false },
      communication: { access: false },
      reports: { access: false },
      settings: { access: false },
      roles: { manage: false },
      memberships: { manage: false },
    };
  }
}
