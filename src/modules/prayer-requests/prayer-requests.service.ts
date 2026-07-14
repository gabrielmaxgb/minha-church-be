import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MemberStatus } from '@prisma/client';

import { ChurchPermissionsService } from '../../common/services/church-permissions.service';
import { PrismaService } from '../../database/prisma.service';
import { CreatePrayerRequestDto } from './dto/prayer-request.dto';
import {
  toPrayerRequestResponse,
  type PrayerRequestResponse,
} from './prayer-requests.types';

const authorSelect = { id: true, name: true } as const;

@Injectable()
export class PrayerRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly churchPermissions: ChurchPermissionsService,
  ) {}

  async list(
    churchId: string,
    userId: string,
  ): Promise<PrayerRequestResponse[]> {
    const viewer = await this.requireActiveMember(churchId, userId);
    const canModerate = await this.canModerate(churchId, userId);

    const requests = await this.prisma.prayerRequest.findMany({
      where: { churchId, deletedAt: null },
      include: {
        author: { select: authorSelect },
        _count: { select: { prayers: true } },
        prayers: {
          where: { memberId: viewer.id },
          select: { memberId: true },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return requests.map((request) =>
      toPrayerRequestResponse(request, {
        viewerMemberId: viewer.id,
        canModerate,
      }),
    );
  }

  async create(
    churchId: string,
    userId: string,
    dto: CreatePrayerRequestDto,
  ): Promise<PrayerRequestResponse> {
    const author = await this.requireActiveMember(churchId, userId);
    const body = dto.body.trim();
    const canModerate = await this.canModerate(churchId, userId);

    const created = await this.prisma.prayerRequest.create({
      data: {
        churchId,
        authorMemberId: author.id,
        body,
        isAnonymous: Boolean(dto.isAnonymous),
      },
      include: {
        author: { select: authorSelect },
        _count: { select: { prayers: true } },
        prayers: {
          where: { memberId: author.id },
          select: { memberId: true },
          take: 1,
        },
      },
    });

    return toPrayerRequestResponse(created, {
      viewerMemberId: author.id,
      canModerate,
    });
  }

  async remove(
    churchId: string,
    userId: string,
    requestId: string,
  ): Promise<{ ok: true }> {
    const viewer = await this.requireActiveMember(churchId, userId);
    const canModerate = await this.canModerate(churchId, userId);

    const existing = await this.prisma.prayerRequest.findFirst({
      where: { id: requestId, churchId, deletedAt: null },
      select: { id: true, authorMemberId: true },
    });

    if (!existing) {
      throw new NotFoundException('Pedido de oração não encontrado.');
    }

    if (existing.authorMemberId !== viewer.id && !canModerate) {
      throw new ForbiddenException(
        'Você não pode remover este pedido de oração.',
      );
    }

    await this.prisma.prayerRequest.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    });

    return { ok: true };
  }

  async togglePray(
    churchId: string,
    userId: string,
    requestId: string,
  ): Promise<PrayerRequestResponse> {
    const viewer = await this.requireActiveMember(churchId, userId);
    const canModerate = await this.canModerate(churchId, userId);

    const existing = await this.prisma.prayerRequest.findFirst({
      where: { id: requestId, churchId, deletedAt: null },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException('Pedido de oração não encontrado.');
    }

    const already = await this.prisma.prayerRequestPrayer.findUnique({
      where: {
        prayerRequestId_memberId: {
          prayerRequestId: existing.id,
          memberId: viewer.id,
        },
      },
    });

    if (already) {
      await this.prisma.prayerRequestPrayer.delete({
        where: { id: already.id },
      });
    } else {
      await this.prisma.prayerRequestPrayer.create({
        data: {
          prayerRequestId: existing.id,
          memberId: viewer.id,
        },
      });
    }

    const updated = await this.prisma.prayerRequest.findFirstOrThrow({
      where: { id: existing.id },
      include: {
        author: { select: authorSelect },
        _count: { select: { prayers: true } },
        prayers: {
          where: { memberId: viewer.id },
          select: { memberId: true },
          take: 1,
        },
      },
    });

    return toPrayerRequestResponse(updated, {
      viewerMemberId: viewer.id,
      canModerate,
    });
  }

  private async requireActiveMember(churchId: string, userId: string) {
    const member = await this.prisma.member.findFirst({
      where: { churchId, userId, deletedAt: null },
    });

    if (!member) {
      throw new ForbiddenException(
        'É necessário ter um cadastro pastoral vinculado para usar esta área.',
      );
    }

    const access = await this.churchPermissions.getMembershipAccess(
      userId,
      churchId,
    );

    if (access?.isOwner) {
      return member;
    }

    if (member.status !== MemberStatus.active) {
      throw new ForbiddenException(
        'Somente membros ativos podem usar o quadro de oração.',
      );
    }

    return member;
  }

  private async canModerate(churchId: string, userId: string) {
    const access = await this.churchPermissions.getMembershipAccess(
      userId,
      churchId,
    );

    return Boolean(access?.isOwner);
  }
}
