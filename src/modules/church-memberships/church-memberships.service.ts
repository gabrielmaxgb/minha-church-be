import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChurchPermission } from '@prisma/client';

import { ChurchPermissionsService } from '../../common/services/church-permissions.service';
import { AuditService } from '../../common/services/audit.service';
import { PasswordCredentialsService } from '../../common/services/password-credentials.service';
import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
} from '../../common/audit/audit.constants';
import { formatCpf } from '../../common/utils/cpf';
import { isInternalLoginEmail } from '../../common/utils/login-email';
import { resolveUserContactEmail } from '../../common/utils/user-contact-email';
import { decryptSecret } from '../../common/utils/secret-encryption';
import { PrismaService } from '../../database/prisma.service';
import { ChurchRolesService } from '../church-roles/church-roles.service';
import { MembersService } from '../members/members.service';
import { UpdateMembershipDto } from './dto/update-membership.dto';
import type { ChurchMembershipResponse } from './church-memberships.types';
import type { PendingAccessUserResponse } from './pending-access.types';
import type {
  PasswordResetRequestResponse,
  ResetMemberPasswordResponse,
} from './password-reset-request.types';

const membershipInclude = {
  user: {
    select: {
      id: true,
      name: true,
      email: true,
      avatarUrl: true,
      memberProfiles: {
        where: { deletedAt: null },
        select: {
          id: true,
          name: true,
          churchId: true,
          email: true,
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
          systemKey: true,
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
    private readonly config: ConfigService,
    private readonly passwordCredentials: PasswordCredentialsService,
    private readonly membersService: MembersService,
  ) {}

  async findAll(churchId: string): Promise<ChurchMembershipResponse[]> {
    const memberships = await this.prisma.churchMembership.findMany({
      where: { churchId },
      include: membershipInclude,
      orderBy: { user: { name: 'asc' } },
    });

    return memberships.map((membership) =>
      this.toResponse(membership, churchId),
    );
  }

  async findPendingAccessUsers(
    churchId: string,
  ): Promise<PendingAccessUserResponse[]> {
    const secret = this.config.get<string>('jwt.secret') ?? '';

    const users = await this.prisma.user.findMany({
      where: {
        mustChangePassword: true,
        temporaryPasswordEnc: { not: null },
        memberships: { some: { churchId } },
      },
      include: {
        memberProfiles: {
          where: { churchId, deletedAt: null },
          select: {
            name: true,
            email: true,
            phone: true,
            churchId: true,
            deletedAt: true,
          },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return users.flatMap((user) => {
      if (!user.temporaryPasswordEnc) {
        return [];
      }

      let temporaryPassword: string;

      try {
        temporaryPassword = decryptSecret(user.temporaryPasswordEnc, secret);
      } catch {
        return [];
      }

      const member = user.memberProfiles[0] ?? null;

      const login = user.cpf ? formatCpf(user.cpf) : user.email;
      const email =
        member?.email ?? (isInternalLoginEmail(user.email) ? null : user.email);

      return [
        {
          userId: user.id,
          name: member?.name ?? user.name,
          login,
          email,
          cpf: user.cpf ? formatCpf(user.cpf) : null,
          phone: member?.phone ?? null,
          temporaryPassword,
          createdAt: user.createdAt.toISOString(),
        },
      ];
    });
  }

  async findPasswordResetRequests(
    churchId: string,
  ): Promise<PasswordResetRequestResponse[]> {
    const requests = await this.prisma.passwordResetRequest.findMany({
      where: { churchId, status: 'pending' },
      include: {
        user: {
          include: {
            memberProfiles: {
              where: { churchId, deletedAt: null },
              select: {
                name: true,
                email: true,
                phone: true,
                churchId: true,
                deletedAt: true,
              },
              take: 1,
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return requests.map((request) => {
      const user = request.user;
      const member = user.memberProfiles[0] ?? null;
      const login = user.cpf ? formatCpf(user.cpf) : user.email;
      const email =
        member?.email ?? (isInternalLoginEmail(user.email) ? null : user.email);

      return {
        id: request.id,
        userId: user.id,
        name: member?.name ?? user.name,
        login,
        email,
        cpf: user.cpf ? formatCpf(user.cpf) : null,
        phone: member?.phone ?? null,
        createdAt: request.createdAt.toISOString(),
      };
    });
  }

  async resetMemberPassword(
    churchId: string,
    userId: string,
    actorUserId: string,
  ): Promise<ResetMemberPasswordResponse> {
    const membership = await this.prisma.churchMembership.findUnique({
      where: {
        userId_churchId: {
          userId,
          churchId,
        },
      },
    });

    if (!membership) {
      throw new NotFoundException('Usuário não encontrado nesta igreja.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        memberProfiles: {
          where: { churchId, deletedAt: null },
          select: {
            name: true,
            email: true,
            phone: true,
            churchId: true,
            deletedAt: true,
          },
          take: 1,
        },
      },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    const { login, temporaryPassword } =
      await this.passwordCredentials.issueTemporaryPassword(userId);

    await this.prisma.passwordResetRequest.updateMany({
      where: { userId, churchId, status: 'pending' },
      data: {
        status: 'resolved',
        resolvedAt: new Date(),
        resolvedByUserId: actorUserId,
      },
    });

    const member = user.memberProfiles[0] ?? null;
    const email =
      member?.email ?? (isInternalLoginEmail(user.email) ? null : user.email);

    const actor = await this.prisma.user.findUnique({
      where: { id: actorUserId },
      select: { name: true },
    });
    const targetName = member?.name ?? user.name;

    await this.auditService.log({
      churchId,
      actorUserId,
      action: AUDIT_ACTIONS.membershipPasswordReset,
      targetType: AUDIT_TARGET_TYPES.user,
      targetId: userId,
      summary: `${actor?.name ?? 'Administrador'} gerou nova senha temporária para ${targetName}`,
      metadata: {
        targetUserId: userId,
        targetEmail: user.email,
      },
    });

    return {
      userId,
      name: targetName,
      login,
      email,
      cpf: user.cpf ? formatCpf(user.cpf) : null,
      temporaryPassword,
    };
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
      systemKey?: string;
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
      .filter(
        (role) =>
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
        systemKey: role.systemKey ?? undefined,
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

    if (dto.isOwner === true && !membership.isOwner) {
      this.assertCanReceiveOwnership(membership, churchId);
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
      const memberRole = await this.prisma.churchRole.findFirst({
        where: { churchId, systemKey: 'member' },
        select: { id: true },
      });

      const uniqueRoleIds = [
        ...new Set([
          ...dto.roleIds,
          ...(memberRole ? [memberRole.id] : []),
        ]),
      ];

      if (
        uniqueRoleIds.length === 0 &&
        !membership.isOwner &&
        dto.isOwner !== true
      ) {
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

      // Persist the forced member role for the transaction below.
      dto.roleIds = uniqueRoleIds;
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
        const singleHolderRoles = await tx.churchRole.findMany({
          where: {
            churchId,
            id: { in: dto.roleIds },
            singleHolder: true,
          },
          select: { id: true },
        });

        for (const role of singleHolderRoles) {
          await tx.churchMembershipRole.deleteMany({
            where: {
              roleId: role.id,
              membershipId: { not: membership.id },
              membership: { churchId },
            },
          });
        }

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

    await this.membersService.ensurePastoralRecordForUser(
      churchId,
      targetUserId,
    );

    if (ownerChanged && response.isOwner) {
      await this.requireOwnerVerificationOnPromotion(targetUserId);
    }

    return response;
  }

  async transferOwnership(
    churchId: string,
    targetUserId: string,
    actorUserId: string,
  ): Promise<ChurchMembershipResponse> {
    if (targetUserId === actorUserId) {
      throw new BadRequestException(
        'Escolha outra pessoa para receber a propriedade.',
      );
    }

    const actorAccess = await this.churchPermissions.getMembershipAccess(
      actorUserId,
      churchId,
    );

    if (!actorAccess?.isOwner) {
      throw new ForbiddenException(
        'Somente o proprietário pode transferir a propriedade.',
      );
    }

    const [actorMembership, targetMembership] = await Promise.all([
      this.prisma.churchMembership.findUnique({
        where: {
          userId_churchId: { userId: actorUserId, churchId },
        },
      }),
      this.prisma.churchMembership.findUnique({
        where: {
          userId_churchId: { userId: targetUserId, churchId },
        },
        include: membershipInclude,
      }),
    ]);

    if (!actorMembership || !targetMembership) {
      throw new NotFoundException('Usuário não encontrado nesta igreja.');
    }

    if (targetMembership.isOwner) {
      throw new BadRequestException(
        'Este usuário já é proprietário da igreja.',
      );
    }

    this.assertCanReceiveOwnership(targetMembership, churchId);

    const memberRole = await this.prisma.churchRole.findFirst({
      where: { churchId, systemKey: 'member' },
      select: { id: true, name: true },
    });

    if (!memberRole) {
      throw new BadRequestException(
        'Cargo de membro não encontrado nesta igreja.',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.churchMembership.update({
        where: { id: actorMembership.id },
        data: { isOwner: false },
      });

      await tx.churchMembershipRole.createMany({
        data: [
          {
            membershipId: actorMembership.id,
            roleId: memberRole.id,
          },
        ],
        skipDuplicates: true,
      });

      return tx.churchMembership.update({
        where: { id: targetMembership.id },
        data: { isOwner: true },
        include: membershipInclude,
      });
    });

    const response = this.toResponse(updated, churchId);

    const [actor, target] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: actorUserId },
        select: { name: true },
      }),
      this.prisma.user.findUnique({
        where: { id: targetUserId },
        select: { name: true },
      }),
    ]);

    await this.auditService.log({
      churchId,
      actorUserId,
      action: AUDIT_ACTIONS.membershipUpdated,
      targetType: AUDIT_TARGET_TYPES.membership,
      targetId: targetMembership.id,
      summary: `${actor?.name ?? 'Usuário'} transferiu a propriedade da igreja para ${target?.name ?? 'outro usuário'}`,
      metadata: {
        targetUserId,
        targetEmail: targetMembership.user.email,
        isOwner: { before: false, after: true },
        transferredFromUserId: actorUserId,
        formerOwnerRole: memberRole.name,
      },
    });

    await this.membersService.ensurePastoralRecordForUser(
      churchId,
      targetUserId,
    );

    await this.requireOwnerVerificationOnPromotion(targetUserId);

    return response;
  }

  private assertCanReceiveOwnership(
    membership: {
      user: {
        email: string;
        memberProfiles: Array<{
          churchId: string;
          email: string | null;
          deletedAt: Date | null;
        }>;
      };
    },
    churchId: string,
  ): void {
    const memberProfile =
      membership.user.memberProfiles.find(
        (profile) =>
          profile.churchId === churchId && profile.deletedAt === null,
      ) ?? null;

    const contactEmail = resolveUserContactEmail(
      membership.user.email,
      memberProfile?.email,
    );

    if (!contactEmail) {
      throw new BadRequestException(
        'A propriedade só pode ser transferida para quem tem e-mail cadastrado no membro.',
      );
    }
  }

  private async requireOwnerVerificationOnPromotion(
    userId: string,
  ): Promise<void> {
    const verificationRequired =
      this.config.get<boolean>('email.verificationRequired') ?? false;

    if (!verificationRequired) {
      return;
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: null },
    });
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
        memberProfiles: Array<{
          id: string;
          name: string;
          churchId: string;
          email: string | null;
          deletedAt: Date | null;
        }>;
      };
      roleAssignments: Array<{
        role: {
          id: string;
          name: string;
          color: string | null;
          isSystem: boolean;
          systemKey: string | null;
          sortOrder: number;
        };
      }>;
    },
    churchId: string,
  ): ChurchMembershipResponse {
    const memberProfile =
      membership.user.memberProfiles.find(
        (profile) =>
          profile.churchId === churchId && profile.deletedAt === null,
      ) ?? null;

    const roles = membership.roleAssignments
      .map((assignment) => assignment.role)
      .sort(
        (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
      );

    return {
      id: membership.id,
      userId: membership.userId,
      churchId: membership.churchId,
      isOwner: membership.isOwner,
      canReceiveOwnership: Boolean(
        resolveUserContactEmail(
          membership.user.email,
          memberProfile?.email,
        ),
      ),
      roles: roles.map((role) => ({
        id: role.id,
        name: role.name,
        color: role.color ?? undefined,
        isSystem: role.isSystem,
        systemKey: role.systemKey ?? undefined,
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
