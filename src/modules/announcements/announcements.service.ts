import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AnnouncementAudienceType,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import {
  AnnouncementResponse,
  resolveAnnouncementStatus,
} from './announcements.types';
import {
  CreateAnnouncementDto,
  UpdateAnnouncementDto,
} from './dto/announcement.dto';

type AnnouncementWithRelations = Prisma.AnnouncementGetPayload<{
  include: {
    ministries: { include: { ministry: { select: { id: true; name: true } } } };
    createdBy: { select: { name: true } };
  };
}>;

const announcementInclude = {
  ministries: {
    include: { ministry: { select: { id: true, name: true } } },
  },
  createdBy: { select: { name: true } },
} satisfies Prisma.AnnouncementInclude;

@Injectable()
export class AnnouncementsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Comunicados endereçados ao usuário (igreja inteira + seus ministérios). */
  async listForViewer(
    churchId: string,
    userId: string,
  ): Promise<AnnouncementResponse[]> {
    const ministryIds = await this.getViewerMinistryIds(churchId, userId);
    const now = new Date();

    const announcements = await this.prisma.announcement.findMany({
      where: this.buildViewerWhere(churchId, ministryIds, now),
      include: {
        ...announcementInclude,
        reads: { where: { userId }, select: { userId: true } },
      },
      orderBy: [
        { pinned: 'desc' },
        { publishedAt: 'desc' },
        { createdAt: 'desc' },
      ],
    });

    return announcements.map((announcement) => ({
      ...this.toResponse(announcement, now),
      isRead:
        announcement.createdByUserId === userId ||
        announcement.reads.length > 0,
    }));
  }

  /** Todos os comunicados para quem gerencia (inclui agendados e expirados). */
  async listForManagement(churchId: string): Promise<AnnouncementResponse[]> {
    const now = new Date();

    const announcements = await this.prisma.announcement.findMany({
      where: { churchId, deletedAt: null },
      include: {
        ...announcementInclude,
        _count: { select: { reads: true } },
      },
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
    });

    return announcements.map((announcement) => ({
      ...this.toResponse(announcement, now),
      readCount: announcement._count.reads,
    }));
  }

  async create(
    churchId: string,
    userId: string,
    dto: CreateAnnouncementDto,
  ): Promise<AnnouncementResponse> {
    const audienceType = dto.audienceType;
    const ministryIds = await this.resolveTargetMinistries(
      churchId,
      audienceType,
      dto.ministryIds,
    );

    const publishedAt = dto.publishedAt ? new Date(dto.publishedAt) : new Date();
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    this.assertExpiryAfterPublish(publishedAt, expiresAt);

    const created = await this.prisma.announcement.create({
      data: {
        churchId,
        title: dto.title.trim(),
        body: dto.body.trim(),
        priority: dto.priority ?? undefined,
        audienceType,
        pinned: dto.pinned ?? false,
        publishedAt,
        expiresAt,
        createdByUserId: userId,
        ministries:
          ministryIds.length > 0
            ? { create: ministryIds.map((ministryId) => ({ ministryId })) }
            : undefined,
      },
      include: announcementInclude,
    });

    return this.toResponse(created, new Date());
  }

  async update(
    churchId: string,
    announcementId: string,
    dto: UpdateAnnouncementDto,
  ): Promise<AnnouncementResponse> {
    const existing = await this.getManagedOrThrow(churchId, announcementId);

    const nextAudience = dto.audienceType ?? existing.audienceType;

    // Só recalcula os alvos quando a audiência muda ou uma nova lista é enviada.
    const shouldSyncMinistries =
      dto.audienceType !== undefined || dto.ministryIds !== undefined;

    let targetMinistryIds: string[] | null = null;
    if (shouldSyncMinistries) {
      targetMinistryIds = await this.resolveTargetMinistries(
        churchId,
        nextAudience,
        dto.ministryIds ??
          existing.ministries.map((link) => link.ministryId),
      );
    }

    const nextPublishedAt =
      dto.publishedAt === undefined
        ? existing.publishedAt
        : dto.publishedAt === null
          ? null
          : new Date(dto.publishedAt);
    const nextExpiresAt =
      dto.expiresAt === undefined
        ? existing.expiresAt
        : dto.expiresAt === null
          ? null
          : new Date(dto.expiresAt);
    this.assertExpiryAfterPublish(nextPublishedAt, nextExpiresAt);

    const data: Prisma.AnnouncementUpdateInput = {};

    if (dto.title !== undefined) {
      data.title = dto.title.trim();
    }
    if (dto.body !== undefined) {
      data.body = dto.body.trim();
    }
    if (dto.priority !== undefined) {
      data.priority = dto.priority;
    }
    if (dto.audienceType !== undefined) {
      data.audienceType = dto.audienceType;
    }
    if (dto.pinned !== undefined) {
      data.pinned = dto.pinned;
    }
    if (dto.publishedAt !== undefined) {
      data.publishedAt = nextPublishedAt;
    }
    if (dto.expiresAt !== undefined) {
      data.expiresAt = nextExpiresAt;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.announcement.update({
        where: { id: announcementId },
        data,
      });

      if (targetMinistryIds !== null) {
        await tx.announcementMinistry.deleteMany({
          where: { announcementId },
        });

        if (targetMinistryIds.length > 0) {
          await tx.announcementMinistry.createMany({
            data: targetMinistryIds.map((ministryId) => ({
              announcementId,
              ministryId,
            })),
            skipDuplicates: true,
          });
        }
      }
    });

    const updated = await this.prisma.announcement.findFirstOrThrow({
      where: { id: announcementId, churchId },
      include: announcementInclude,
    });

    return this.toResponse(updated, new Date());
  }

  async remove(churchId: string, announcementId: string): Promise<void> {
    await this.getManagedOrThrow(churchId, announcementId);

    await this.prisma.announcement.update({
      where: { id: announcementId },
      data: { deletedAt: new Date() },
    });
  }

  async markRead(
    churchId: string,
    announcementId: string,
    userId: string,
  ): Promise<void> {
    const ministryIds = await this.getViewerMinistryIds(churchId, userId);
    const now = new Date();

    const visible = await this.prisma.announcement.findFirst({
      where: {
        id: announcementId,
        ...this.buildViewerWhere(churchId, ministryIds, now),
      },
      select: { id: true },
    });

    if (!visible) {
      throw new NotFoundException('Comunicado não encontrado.');
    }

    await this.prisma.announcementRead.upsert({
      where: {
        announcementId_userId: { announcementId, userId },
      },
      update: {},
      create: { announcementId, userId },
    });
  }

  async unreadCount(churchId: string, userId: string): Promise<number> {
    const ministryIds = await this.getViewerMinistryIds(churchId, userId);
    const now = new Date();

    return this.prisma.announcement.count({
      where: {
        ...this.buildViewerWhere(churchId, ministryIds, now),
        reads: { none: { userId } },
        NOT: { createdByUserId: userId },
      },
    });
  }

  private buildViewerWhere(
    churchId: string,
    ministryIds: string[],
    now: Date,
  ): Prisma.AnnouncementWhereInput {
    return {
      churchId,
      deletedAt: null,
      publishedAt: { lte: now },
      AND: [
        { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        {
          OR: [
            { audienceType: AnnouncementAudienceType.church_wide },
            {
              audienceType: AnnouncementAudienceType.ministries,
              ministries: { some: { ministryId: { in: ministryIds } } },
            },
          ],
        },
      ],
    };
  }

  private async getViewerMinistryIds(
    churchId: string,
    userId: string,
  ): Promise<string[]> {
    const member = await this.prisma.member.findFirst({
      where: { churchId, userId, deletedAt: null },
      select: {
        ministryLinks: {
          where: { endedAt: null },
          select: { ministryId: true },
        },
      },
    });

    return member?.ministryLinks.map((link) => link.ministryId) ?? [];
  }

  private async resolveTargetMinistries(
    churchId: string,
    audienceType: AnnouncementAudienceType,
    ministryIds: string[] | undefined,
  ): Promise<string[]> {
    if (audienceType === AnnouncementAudienceType.church_wide) {
      return [];
    }

    const unique = [...new Set((ministryIds ?? []).filter(Boolean))];

    if (unique.length === 0) {
      throw new BadRequestException(
        'Selecione ao menos um ministério para este comunicado.',
      );
    }

    const found = await this.prisma.ministry.count({
      where: { id: { in: unique }, churchId },
    });

    if (found !== unique.length) {
      throw new BadRequestException(
        'Um ou mais ministérios selecionados não pertencem à igreja.',
      );
    }

    return unique;
  }

  private assertExpiryAfterPublish(
    publishedAt: Date | null,
    expiresAt: Date | null,
  ): void {
    if (!expiresAt) {
      return;
    }

    const base = publishedAt ?? new Date();

    if (expiresAt.getTime() <= base.getTime()) {
      throw new BadRequestException(
        'A data de expiração deve ser posterior à publicação.',
      );
    }
  }

  private async getManagedOrThrow(
    churchId: string,
    announcementId: string,
  ): Promise<AnnouncementWithRelations> {
    const announcement = await this.prisma.announcement.findFirst({
      where: { id: announcementId, churchId, deletedAt: null },
      include: announcementInclude,
    });

    if (!announcement) {
      throw new NotFoundException('Comunicado não encontrado.');
    }

    return announcement;
  }

  private toResponse(
    announcement: AnnouncementWithRelations,
    now: Date,
  ): AnnouncementResponse {
    return {
      id: announcement.id,
      churchId: announcement.churchId,
      title: announcement.title,
      body: announcement.body,
      priority: announcement.priority,
      audienceType: announcement.audienceType,
      ministries: announcement.ministries.map((link) => ({
        id: link.ministry.id,
        name: link.ministry.name,
      })),
      pinned: announcement.pinned,
      status: resolveAnnouncementStatus(
        announcement.publishedAt,
        announcement.expiresAt,
        now,
      ),
      publishedAt: announcement.publishedAt?.toISOString() ?? null,
      expiresAt: announcement.expiresAt?.toISOString() ?? null,
      createdByUserId: announcement.createdByUserId,
      createdByName: announcement.createdBy?.name ?? null,
      createdAt: announcement.createdAt.toISOString(),
      updatedAt: announcement.updatedAt.toISOString(),
    };
  }
}
