import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ChurchPermission } from '@prisma/client';

import { ChurchPermissionsService } from '../../common/services/church-permissions.service';
import { AuditService } from '../../common/services/audit.service';
import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
} from '../../common/audit/audit.constants';
import { PrismaService } from '../../database/prisma.service';
import { ChurchRolesService } from '../church-roles/church-roles.service';
import { UpdateMembershipDto } from './dto/update-membership.dto';
import type { ChurchMembershipResponse } from './church-memberships.types';

const membershipInclude = {
  user: {
    select: {
      id: true,
      name: true,
      email: true,
      avatarUrl: true,
      memberProfile: {
        select: {
          id: true,
          name: true,
          churchId: true,
          deletedAt: true,
        },
      },
    },
  },
  roleAssignments: {
    include: {
      role: {
        select: {
          id: true,
          name: true,
          color: true,
          isSystem: true,
          sortOrder: true,
          permissions: true,
        },
      },
    },
  },
} as const;

@Injectable()
export class ChurchMembershipsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly churchPermissions: ChurchPermissionsService,
    private readonly churchRolesService: ChurchRolesService,
    private readonly auditService: AuditService,
  ) {}

  async findAll(churchId: string): Promise<ChurchMembershipResponse[]> {
    const memberships = await this.prisma.churchMembership.findMany({
      where: { churchId },
      include: membershipInclude,
      orderBy: { user: { name: 'asc' } },
    });

    return memberships.map((membership) => this.toResponse(membership, churchId));
  }

  async findAssignableRoles(
    churchId: string,
    actorUserId: string,
  ): Promise<
    Array<{
      id: string;
      name: string;
      color?: string;
      isSystem: boolean;
      sortOrder: number;
    }>
  > {
    const actorAccess = await this.churchPermissions.getMembershipAccess(
      actorUserId,
      churchId,
    );

    if (!actorAccess) {
      throw new ForbiddenException('Sem acesso a esta igreja.');
    }

    const canManageMemberships =
      actorAccess.isOwner ||
      actorAccess.permissions.has(ChurchPermission.memberships_manage);

    if (!canManageMemberships) {
      throw new ForbiddenException('Permissão insuficiente.');
    }

    const roles = await this.prisma.churchRole.findMany({
      where: { churchId },
      include: { permissions: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    const actorPermissions = actorAccess.isOwner
      ? new Set(Object.values(ChurchPermission))
      : actorAccess.permissions;

    return roles
      .filter((role) =>
        actorAccess.isOwner ||
        this.churchPermissions.permissionsAreSubsetOf(
          role.permissions.map((entry) => entry.permission),
          actorPermissions,
        ),
      )
      .map((role) => ({
        id: role.id,
        name: role.name,
        color: role.color ?? undefined,
        isSystem: role.isSystem,
        sortOrder: role.sortOrder,
      }));
  }

  async updateMembership(
    churchId: string,
    targetUserId: string,
    actorUserId: string,
    dto: UpdateMembershipDto,
  ): Promise<ChurchMembershipResponse> {
    if (targetUserId === actorUserId) {
      throw new BadRequestException('Você não pode alterar o próprio acesso.');
    }

    if (dto.roleIds === undefined && dto.isOwner === undefined) {
      throw new BadRequestException('Nenhuma alteração informada.');
    }

    const actorAccess = await this.churchPermissions.getMembershipAccess(
      actorUserId,
      churchId,
    );

    if (!actorAccess) {
      throw new ForbiddenException('Sem acesso a esta igreja.');
    }

    const canManageMemberships =
      actorAccess.isOwner ||
      actorAccess.permissions.has(ChurchPermission.memberships_manage);

    if (!canManageMemberships) {
      throw new ForbiddenException('Permissão insuficiente.');
    }

    const membership = await this.prisma.churchMembership.findUnique({
      where: {
        userId_churchId: {
          userId: targetUserId,
          churchId,
        },
      },
      include: membershipInclude,
    });

    if (!membership) {
      throw new NotFoundException('Usuário não encontrado nesta igreja.');
    }

    const targetPermissions = new Set<ChurchPermission>();
    for (const assignment of membership.roleAssignments) {
      for (const entry of assignment.role.permissions) {
        targetPermissions.add(entry.permission);
      }
    }

    const actorPermissions = actorAccess.isOwner
      ? new Set(Object.values(ChurchPermission))
      : actorAccess.permissions;

    if (
      !actorAccess.isOwner &&
      !this.churchPermissions.permissionsAreSubsetOf(
        targetPermissions,
        actorPermissions,
      )
    ) {
      throw new ForbiddenException(
        'Você não pode alterar o acesso deste usuário.',
      );
    }

    if (dto.isOwner !== undefined) {
      if (!actorAccess.isOwner) {
        throw new ForbiddenException(
          'Somente o proprietário pode transferir a propriedade.',
        );
      }

      if (dto.isOwner === false && membership.isOwner) {
        await this.ensureAnotherOwnerRemains(churchId, targetUserId);
      }
    }

    if (dto.roleIds !== undefined) {
      const uniqueRoleIds = [...new Set(dto.roleIds)];

      if (uniqueRoleIds.length === 0 && !membership.isOwner && dto.isOwner !== true) {
        throw new BadRequestException(
          'O usuário precisa ter pelo menos um cargo ou ser proprietário.',
        );
      }

      const rolePermissions = await this.churchRolesService.findRolePermissions(
        churchId,
        uniqueRoleIds,
      );

      if (rolePermissions.size !== uniqueRoleIds.length) {
        throw new BadRequestException('Um ou mais cargos são inválidos.');
      }

      const requestedPermissions = new Set<ChurchPermission>();
      for (const permissions of rolePermissions.values()) {
        for (const permission of permissions) {
          requestedPermissions.add(permission);
        }
      }

      if (
        !actorAccess.isOwner &&
        !this.churchPermissions.permissionsAreSubsetOf(
          requestedPermissions,
          actorPermissions,
        )
      ) {
        throw new ForbiddenException(
          'Você não pode atribuir cargos com permissões superiores às suas.',
        );
      }
    }

    const beforeRoleNames = membership.roleAssignments
      .map((assignment) => assignment.role.name)
      .sort();
    const beforeIsOwner = membership.isOwner;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.isOwner !== undefined) {
        await tx.churchMembership.update({
          where: { id: membership.id },
          data: { isOwner: dto.isOwner },
        });
      }

      if (dto.roleIds !== undefined) {
        await tx.churchMembershipRole.deleteMany({
          where: { membershipId: membership.id },
        });

        if (dto.roleIds.length > 0) {
          await tx.churchMembershipRole.createMany({
            data: dto.roleIds.map((roleId) => ({
              membershipId: membership.id,
              roleId,
            })),
          });
        }
      }

      return tx.churchMembership.findUniqueOrThrow({
        where: { id: membership.id },
        include: membershipInclude,
      });
    });

    const response = this.toResponse(updated, churchId);
    const afterRoleNames = response.roles.map((role) => role.name).sort();
    const rolesChanged =
      dto.roleIds !== undefined &&
      JSON.stringify(beforeRoleNames) !== JSON.stringify(afterRoleNames);
    const ownerChanged =
      dto.isOwner !== undefined && beforeIsOwner !== response.isOwner;

    if (rolesChanged || ownerChanged) {
      const actor = await this.prisma.user.findUnique({
        where: { id: actorUserId },
        select: { name: true },
      });
      const actorName = actor?.name ?? 'Usuário';
      const targetName = membership.user.name;

      let summary = `${actorName} alterou o acesso de ${targetName}`;

      if (ownerChanged && response.isOwner) {
        summary = `${actorName} tornou ${targetName} proprietário da igreja`;
      } else if (ownerChanged && !response.isOwner) {
        summary = `${actorName} removeu a propriedade de ${targetName}`;
      } else if (rolesChanged) {
        summary = `${actorName} alterou cargos de ${targetName}`;
      }

      await this.auditService.log({
        churchId,
        actorUserId,
        action: AUDIT_ACTIONS.membershipUpdated,
        targetType: AUDIT_TARGET_TYPES.membership,
        targetId: membership.id,
        summary,
        metadata: {
          targetUserId: membership.userId,
          targetEmail: membership.user.email,
          ...(rolesChanged
            ? {
                roles: {
                  before: beforeRoleNames,
                  after: afterRoleNames,
                },
              }
            : {}),
          ...(ownerChanged
            ? {
                isOwner: {
                  before: beforeIsOwner,
                  after: response.isOwner,
                },
              }
            : {}),
        },
      });
    }

    return response;
  }

  private async ensureAnotherOwnerRemains(
    churchId: string,
    excludedUserId: string,
  ) {
    const ownerCount = await this.prisma.churchMembership.count({
      where: {
        churchId,
        isOwner: true,
        userId: { not: excludedUserId },
      },
    });

    if (ownerCount === 0) {
      throw new BadRequestException(
        'A igreja precisa ter pelo menos um proprietário.',
      );
    }
  }

  private toResponse(
    membership: {
      id: string;
      userId: string;
      churchId: string;
      isOwner: boolean;
      createdAt: Date;
      user: {
        id: string;
        name: string;
        email: string;
        avatarUrl: string | null;
        memberProfile: {
          id: string;
          name: string;
          churchId: string;
          deletedAt: Date | null;
        } | null;
      };
      roleAssignments: Array<{
        role: {
          id: string;
          name: string;
          color: string | null;
          isSystem: boolean;
          sortOrder: number;
        };
      }>;
    },
    churchId: string,
  ): ChurchMembershipResponse {
    const memberProfile =
      membership.user.memberProfile &&
      membership.user.memberProfile.churchId === churchId &&
      membership.user.memberProfile.deletedAt === null
        ? membership.user.memberProfile
        : null;

    const roles = membership.roleAssignments
      .map((assignment) => assignment.role)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

    return {
      id: membership.id,
      userId: membership.userId,
      churchId: membership.churchId,
      isOwner: membership.isOwner,
      roles: roles.map((role) => ({
        id: role.id,
        name: role.name,
        color: role.color ?? undefined,
        isSystem: role.isSystem,
      })),
      createdAt: membership.createdAt.toISOString(),
      user: {
        id: membership.user.id,
        name: membership.user.name,
        email: membership.user.email,
        avatarUrl: membership.user.avatarUrl ?? undefined,
      },
      memberId: memberProfile?.id,
      memberName: memberProfile?.name,
    };
  }
}
