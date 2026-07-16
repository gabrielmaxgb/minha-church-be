import { Injectable } from '@nestjs/common';
import { ChurchPermission } from '@prisma/client';

import { ALL_CHURCH_PERMISSIONS } from '../permissions/church-permissions.constants';
import {
  membershipCacheKey,
  requestContextStorage,
} from '../perf/perf-request-context';
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
    const store = requestContextStorage.getStore();
    const key = membershipCacheKey(userId, churchId);

    if (store) {
      const cached = store.membershipCache.get(key);

      if (cached?.status === 'resolved') {
        return cached.value as MembershipAccessContext | null;
      }

      if (cached?.status === 'pending') {
        return cached.promise as Promise<MembershipAccessContext | null>;
      }

      const promise = this.loadMembershipAccess(userId, churchId).then(
        (value) => {
          store.membershipCache.set(key, { status: 'resolved', value });
          return value;
        },
      );

      store.membershipCache.set(key, { status: 'pending', promise });

      return promise;
    }

    return this.loadMembershipAccess(userId, churchId);
  }

  private async loadMembershipAccess(
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

    // Non-owners lose access once the church is marked for closure.
    if (!membership.isOwner) {
      const church = await this.prisma.church.findUnique({
        where: { id: churchId },
        select: { deletedAt: true },
      });
      if (church?.deletedAt) {
        return null;
      }
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
    let rosterMinistryIds: string[] = [];
    let teamMinistryIds: string[] = [];
    let rolesMinistryIds: string[] = [];

    if (canManageChurchEvents) {
      const ministries = await this.prisma.ministry.findMany({
        where: { churchId, isActive: true },
        select: { id: true },
      });

      ministryIds = ministries.map((ministry) => ministry.id);
    } else {
      ministryIds = await this.resolveScopedMinistryIds(
        userId,
        churchId,
        'canManageEvents',
      );
    }

    if (granted.has(ChurchPermission.ministries_manage)) {
      const ministries = await this.prisma.ministry.findMany({
        where: { churchId, isActive: true },
        select: { id: true },
      });
      const allIds = ministries.map((ministry) => ministry.id);

      rosterMinistryIds = allIds;
      teamMinistryIds = allIds;
      rolesMinistryIds = allIds;
    } else {
      const [rosterIds, teamIds, rolesIds] = await Promise.all([
        this.resolveScopedMinistryIds(userId, churchId, 'canManageRoster'),
        this.resolveScopedMinistryIds(userId, churchId, 'canManageTeam'),
        this.resolveScopedMinistryIds(userId, churchId, 'canManageRoles'),
      ]);

      rosterMinistryIds = rosterIds;
      teamMinistryIds = teamIds;
      rolesMinistryIds = rolesIds;

      if (granted.has(ChurchPermission.members_manage)) {
        const ministries = await this.prisma.ministry.findMany({
          where: { churchId, isActive: true },
          select: { id: true },
        });
        teamMinistryIds = ministries.map((ministry) => ministry.id);
      }
    }

    const membersAccess =
      granted.has(ChurchPermission.members_access) ||
      granted.has(ChurchPermission.members_manage) ||
      teamMinistryIds.length > 0;
    const ministriesAccess =
      granted.has(ChurchPermission.ministries_access) ||
      granted.has(ChurchPermission.ministries_manage) ||
      rosterMinistryIds.length > 0 ||
      teamMinistryIds.length > 0 ||
      rolesMinistryIds.length > 0;
    const activitiesAccess =
      granted.has(ChurchPermission.activities_access) ||
      canManageChurchEvents ||
      ministryIds.length > 0;

    return {
      dashboard: {
        access: granted.has(ChurchPermission.dashboard_access),
      },
      members: {
        access: membersAccess,
        manage: granted.has(ChurchPermission.members_manage),
      },
      ministries: {
        access: ministriesAccess,
        manage: granted.has(ChurchPermission.ministries_manage),
        rosterMinistryIds,
        teamMinistryIds,
        rolesMinistryIds,
      },
      activities: {
        access: activitiesAccess,
        createChurchWide: canManageChurchEvents,
        ministryIds,
      },
      schedules: {
        access: granted.has(ChurchPermission.schedules_access),
      },
      finances: {
        access:
          granted.has(ChurchPermission.finances_access) ||
          granted.has(ChurchPermission.receivables_manage),
        manage: granted.has(ChurchPermission.receivables_manage),
      },
      communication: {
        access:
          granted.has(ChurchPermission.communication_access) ||
          granted.has(ChurchPermission.communication_manage),
        manage: granted.has(ChurchPermission.communication_manage),
      },
      reports: { access: granted.has(ChurchPermission.reports_access) },
      settings: { access: granted.has(ChurchPermission.settings_access) },
      roles: { manage: granted.has(ChurchPermission.roles_manage) },
      memberships: {
        manage: granted.has(ChurchPermission.memberships_manage),
      },
      counseling: {
        receive: granted.has(ChurchPermission.counseling_receive),
      },
    };
  }

  async canManageMinistryRosters(
    userId: string,
    churchId: string,
    ministryId: string,
  ): Promise<boolean> {
    return this.canManageMinistryByFlag(
      userId,
      churchId,
      ministryId,
      'canManageRoster',
      { ministriesManage: true },
    );
  }

  async canManageMinistryTeam(
    userId: string,
    churchId: string,
    ministryId: string,
  ): Promise<boolean> {
    return this.canManageMinistryByFlag(
      userId,
      churchId,
      ministryId,
      'canManageTeam',
      { ministriesManage: true, membersManage: true },
    );
  }

  async canManageMinistryRoles(
    userId: string,
    churchId: string,
    ministryId: string,
  ): Promise<boolean> {
    return this.canManageMinistryByFlag(
      userId,
      churchId,
      ministryId,
      'canManageRoles',
      { ministriesManage: true },
    );
  }

  async canListChurchMembers(
    userId: string,
    churchId: string,
  ): Promise<boolean> {
    const permissions = await this.getUserPermissions(userId, churchId);

    return (
      permissions.members.access ||
      permissions.members.manage ||
      permissions.ministries.manage ||
      permissions.ministries.teamMinistryIds.length > 0
    );
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

  private async canManageMinistryByFlag(
    userId: string,
    churchId: string,
    ministryId: string,
    flag: 'canManageRoster' | 'canManageTeam' | 'canManageRoles',
    overrides: { ministriesManage?: boolean; membersManage?: boolean },
  ): Promise<boolean> {
    const access = await this.getMembershipAccess(userId, churchId);

    if (!access) {
      return false;
    }

    if (access.isOwner) {
      return true;
    }

    const ministry = await this.prisma.ministry.findFirst({
      where: { id: ministryId, churchId, isActive: true },
    });

    if (!ministry) {
      return false;
    }

    if (
      overrides.ministriesManage &&
      access.permissions.has(ChurchPermission.ministries_manage)
    ) {
      return true;
    }

    if (
      overrides.membersManage &&
      access.permissions.has(ChurchPermission.members_manage)
    ) {
      return true;
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
                  [flag]: true,
                },
              },
            },
          },
        },
      },
    });

    return (member?.ministryLinks.length ?? 0) > 0;
  }

  private async resolveScopedMinistryIds(
    userId: string,
    churchId: string,
    flag: 'canManageEvents' | 'canManageRoster' | 'canManageTeam' | 'canManageRoles',
  ): Promise<string[]> {
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
                  [flag]: true,
                },
              },
            },
          },
          include: {
            ministry: {
              select: { id: true, isActive: true },
            },
          },
        },
      },
    });

    return (
      member?.ministryLinks
        .filter((link) => link.ministry.isActive)
        .map((link) => link.ministryId) ?? []
    );
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
      .sort(
        (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
      );

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
      dashboard: { access: false },
      members: { access: false, manage: false },
      ministries: {
        access: false,
        manage: false,
        rosterMinistryIds: [],
        teamMinistryIds: [],
        rolesMinistryIds: [],
      },
      activities: { access: false, createChurchWide: false, ministryIds: [] },
      schedules: { access: false },
      finances: { access: false, manage: false },
      communication: { access: false, manage: false },
      reports: { access: false },
      settings: { access: false },
      roles: { manage: false },
      memberships: { manage: false },
      counseling: { receive: false },
    };
  }
}
