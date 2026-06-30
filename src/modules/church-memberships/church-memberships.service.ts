import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';

import type { UserRole as AppUserRole } from '../../common/types/user-role';
import { PrismaService } from '../../database/prisma.service';
import { UpdateMembershipDto } from './dto/update-membership.dto';
import type { ChurchMembershipResponse } from './church-memberships.types';

const ASSIGNABLE_ROLES: Record<AppUserRole, readonly AppUserRole[]> = {
  owner: [
    'owner',
    'admin',
    'pastor',
    'secretary',
    'treasurer',
    'leader',
    'member',
  ],
  admin: ['pastor', 'secretary', 'treasurer', 'leader', 'member'],
  pastor: ['secretary', 'treasurer', 'leader', 'member'],
  secretary: [],
  treasurer: [],
  leader: [],
  member: [],
};

@Injectable()
export class ChurchMembershipsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(churchId: string): Promise<ChurchMembershipResponse[]> {
    const memberships = await this.prisma.churchMembership.findMany({
      where: { churchId },
      include: {
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
      },
      orderBy: { user: { name: 'asc' } },
    });

    return memberships.map((membership) => {
      const memberProfile =
        membership.user.memberProfile &&
        membership.user.memberProfile.churchId === churchId &&
        membership.user.memberProfile.deletedAt === null
          ? membership.user.memberProfile
          : null;

      return {
        id: membership.id,
        userId: membership.userId,
        churchId: membership.churchId,
        role: membership.role as AppUserRole,
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
    });
  }

  async updateRole(
    churchId: string,
    targetUserId: string,
    actorUserId: string,
    actorRole: AppUserRole,
    dto: UpdateMembershipDto,
  ): Promise<ChurchMembershipResponse> {
    const assignableRoles = ASSIGNABLE_ROLES[actorRole];

    if (!assignableRoles.includes(dto.role)) {
      throw new ForbiddenException('Você não pode atribuir este perfil.');
    }

    if (targetUserId === actorUserId) {
      throw new BadRequestException('Você não pode alterar o próprio perfil.');
    }

    const membership = await this.prisma.churchMembership.findUnique({
      where: {
        userId_churchId: {
          userId: targetUserId,
          churchId,
        },
      },
      include: {
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
      },
    });

    if (!membership) {
      throw new NotFoundException('Usuário não encontrado nesta igreja.');
    }

    if (!this.canModifyTarget(actorRole, membership.role as AppUserRole)) {
      throw new ForbiddenException(
        'Você não pode alterar o perfil deste usuário.',
      );
    }

    if (
      membership.role === UserRole.owner &&
      dto.role !== UserRole.owner
    ) {
      await this.ensureAnotherOwnerRemains(churchId, targetUserId);
    }

    const updated = await this.prisma.churchMembership.update({
      where: { id: membership.id },
      data: { role: dto.role },
      include: {
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
      },
    });

    const memberProfile =
      updated.user.memberProfile &&
      updated.user.memberProfile.churchId === churchId &&
      updated.user.memberProfile.deletedAt === null
        ? updated.user.memberProfile
        : null;

    return {
      id: updated.id,
      userId: updated.userId,
      churchId: updated.churchId,
      role: updated.role as AppUserRole,
      createdAt: updated.createdAt.toISOString(),
      user: {
        id: updated.user.id,
        name: updated.user.name,
        email: updated.user.email,
        avatarUrl: updated.user.avatarUrl ?? undefined,
      },
      memberId: memberProfile?.id,
      memberName: memberProfile?.name,
    };
  }

  private canModifyTarget(
    actorRole: AppUserRole,
    targetRole: AppUserRole,
  ): boolean {
    if (actorRole === 'owner') {
      return true;
    }

    if (actorRole === 'admin') {
      return !['owner', 'admin'].includes(targetRole);
    }

    if (actorRole === 'pastor') {
      return !['owner', 'admin', 'pastor'].includes(targetRole);
    }

    return false;
  }

  private async ensureAnotherOwnerRemains(
    churchId: string,
    excludedUserId: string,
  ) {
    const ownerCount = await this.prisma.churchMembership.count({
      where: {
        churchId,
        role: UserRole.owner,
        userId: { not: excludedUserId },
      },
    });

    if (ownerCount === 0) {
      throw new BadRequestException(
        'A igreja precisa ter pelo menos um proprietário.',
      );
    }
  }
}
