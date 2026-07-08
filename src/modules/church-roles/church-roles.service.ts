import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ChurchPermission } from '@prisma/client';

import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
} from '../../common/audit/audit.constants';
import { diffStringArrays } from '../../common/audit/audit.helpers';
import { CHURCH_PERMISSION_LABELS } from '../../common/permissions/church-permissions.constants';
import { createCustomChurchRoleId } from '../../common/permissions/seed-default-church-roles';
import { AuditService } from '../../common/services/audit.service';
import { PrismaService } from '../../database/prisma.service';
import type {
  CreateChurchRoleDto,
  UpdateChurchRoleDto,
} from './dto/church-role.dto';
import {
  toChurchRoleResponse,
  type ChurchRoleResponse,
} from './church-roles.types';

@Injectable()
export class ChurchRolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async findAll(churchId: string): Promise<ChurchRoleResponse[]> {
    const roles = await this.prisma.churchRole.findMany({
      where: { churchId },
      include: { permissions: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    return roles.map(toChurchRoleResponse);
  }

  async create(
    churchId: string,
    actorUserId: string,
    dto: CreateChurchRoleDto,
  ): Promise<ChurchRoleResponse> {
    const role = await this.prisma.churchRole.create({
      data: {
        id: createCustomChurchRoleId(),
        churchId,
        name: dto.name.trim(),
        color: dto.color,
        sortOrder: dto.sortOrder ?? 100,
        isSystem: false,
        permissions: {
          create: dto.permissions.map((permission) => ({ permission })),
        },
      },
      include: { permissions: true },
    });

    const actorName = await this.getActorName(actorUserId);

    await this.auditService.log({
      churchId,
      actorUserId,
      action: AUDIT_ACTIONS.churchRoleCreated,
      targetType: AUDIT_TARGET_TYPES.churchRole,
      targetId: role.id,
      summary: `${actorName} criou o cargo ${role.name}`,
      metadata: {
        roleName: role.name,
        permissions: role.permissions.map((entry) => entry.permission),
      },
    });

    return toChurchRoleResponse(role);
  }

  async update(
    churchId: string,
    roleId: string,
    actorUserId: string,
    dto: UpdateChurchRoleDto,
  ): Promise<ChurchRoleResponse> {
    const existing = await this.prisma.churchRole.findFirst({
      where: { id: roleId, churchId },
      include: { permissions: true },
    });

    if (!existing) {
      throw new NotFoundException('Cargo não encontrado.');
    }

    if (dto.name !== undefined && existing.isSystem) {
      throw new BadRequestException(
        'Cargos padrão do sistema não podem ser renomeados.',
      );
    }

    const beforePermissions = existing.permissions.map(
      (entry) => entry.permission,
    );

    const role = await this.prisma.$transaction(async (tx) => {
      if (dto.permissions !== undefined) {
        await tx.churchRolePermission.deleteMany({
          where: { roleId },
        });

        if (dto.permissions.length > 0) {
          await tx.churchRolePermission.createMany({
            data: dto.permissions.map((permission) => ({
              roleId,
              permission,
            })),
          });
        }
      }

      return tx.churchRole.update({
        where: { id: roleId },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.color !== undefined ? { color: dto.color } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        },
        include: { permissions: true },
      });
    });

    const afterPermissions = role.permissions.map((entry) => entry.permission);
    const permissionDiff = diffStringArrays(
      beforePermissions,
      afterPermissions,
    );
    const nameChanged =
      dto.name !== undefined && dto.name.trim() !== existing.name;

    if (permissionDiff || nameChanged) {
      const actorName = await this.getActorName(actorUserId);

      await this.auditService.log({
        churchId,
        actorUserId,
        action: AUDIT_ACTIONS.churchRoleUpdated,
        targetType: AUDIT_TARGET_TYPES.churchRole,
        targetId: role.id,
        summary: nameChanged
          ? `${actorName} renomeou o cargo para ${role.name}`
          : `${actorName} alterou permissões do cargo ${role.name}`,
        metadata: {
          roleName: role.name,
          ...(nameChanged
            ? { name: { before: existing.name, after: role.name } }
            : {}),
          ...(permissionDiff
            ? {
                permissions: {
                  added: permissionDiff.added.map(
                    (permission) =>
                      CHURCH_PERMISSION_LABELS[permission as ChurchPermission],
                  ),
                  removed: permissionDiff.removed.map(
                    (permission) =>
                      CHURCH_PERMISSION_LABELS[permission as ChurchPermission],
                  ),
                },
              }
            : {}),
        },
      });
    }

    return toChurchRoleResponse(role);
  }

  async remove(
    churchId: string,
    roleId: string,
    actorUserId: string,
  ): Promise<void> {
    const role = await this.prisma.churchRole.findFirst({
      where: { id: roleId, churchId },
    });

    if (!role) {
      throw new NotFoundException('Cargo não encontrado.');
    }

    if (role.isSystem) {
      throw new BadRequestException(
        'Cargos padrão do sistema não podem ser removidos.',
      );
    }

    // O vínculo em church_membership_roles tem onDelete: Cascade, então a
    // exclusão remove o cargo de todos os usuários automaticamente. Contamos
    // apenas para registrar o impacto na auditoria.
    const affectedMembers = await this.prisma.churchMembershipRole.count({
      where: { roleId },
    });

    await this.prisma.churchRole.delete({
      where: { id: roleId },
    });

    const actorName = await this.getActorName(actorUserId);

    await this.auditService.log({
      churchId,
      actorUserId,
      action: AUDIT_ACTIONS.churchRoleDeleted,
      targetType: AUDIT_TARGET_TYPES.churchRole,
      targetId: roleId,
      summary: `${actorName} excluiu o cargo ${role.name}`,
      metadata: { roleName: role.name, affectedMembers },
    });
  }

  async findRolePermissions(
    churchId: string,
    roleIds: string[],
  ): Promise<Map<string, Set<ChurchPermission>>> {
    const roles = await this.prisma.churchRole.findMany({
      where: {
        churchId,
        id: { in: roleIds },
      },
      include: { permissions: true },
    });

    return new Map(
      roles.map((role) => [
        role.id,
        new Set(role.permissions.map((entry) => entry.permission)),
      ]),
    );
  }

  private async getActorName(actorUserId: string): Promise<string> {
    const actor = await this.prisma.user.findUnique({
      where: { id: actorUserId },
      select: { name: true },
    });

    return actor?.name ?? 'Usuário';
  }
}
