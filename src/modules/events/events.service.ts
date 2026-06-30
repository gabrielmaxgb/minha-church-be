import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ChurchPermission } from '@prisma/client';

import { ChurchPermissionsService } from '../../common/services/church-permissions.service';
import { PrismaService } from '../../database/prisma.service';
import {
  toMinistryEventResponse,
  type MinistryEventResponse,
} from '../ministries/ministries.types';
import {
  CreateChurchEventDto,
  ListChurchEventsQueryDto,
  UpdateChurchEventDto,
} from './dto/event.dto';

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly churchPermissions: ChurchPermissionsService,
  ) {}

  async findAll(
    churchId: string,
    query: ListChurchEventsQueryDto,
  ): Promise<MinistryEventResponse[]> {
    const events = await this.prisma.ministryEvent.findMany({
      where: {
        churchId,
        deletedAt: null,
        ...(query.churchWideOnly ? { ministryId: null } : {}),
        ...(query.ministryId ? { ministryId: query.ministryId } : {}),
        ...(query.from ? { startsAt: { gte: new Date(query.from) } } : {}),
        ...(query.to
          ? { startsAt: { lte: new Date(`${query.to}T23:59:59.999Z`) } }
          : {}),
      },
      include: { ministry: true },
      orderBy: { startsAt: 'asc' },
    });

    return events.map(toMinistryEventResponse);
  }

  async create(
    churchId: string,
    userId: string,
    dto: CreateChurchEventDto,
  ): Promise<MinistryEventResponse> {
    if (dto.ministryId) {
      await this.assertCanManageMinistryEvent(
        userId,
        churchId,
        dto.ministryId,
      );
    } else {
      await this.assertCanManageChurchEvents(userId, churchId);
    }

    const event = await this.prisma.ministryEvent.create({
      data: {
        churchId,
        ministryId: dto.ministryId ?? null,
        name: dto.name.trim(),
        description: dto.description,
        location: dto.location,
        startsAt: new Date(dto.startsAt),
        endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
        createdByUserId: userId,
      },
      include: { ministry: true },
    });

    return toMinistryEventResponse(event);
  }

  async update(
    churchId: string,
    eventId: string,
    userId: string,
    dto: UpdateChurchEventDto,
  ): Promise<MinistryEventResponse> {
    const existing = await this.getEventOrThrow(churchId, eventId);
    await this.assertCanManageEvent(userId, churchId, existing);

    const event = await this.prisma.ministryEvent.update({
      where: { id: eventId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.location !== undefined ? { location: dto.location } : {}),
        ...(dto.startsAt !== undefined ? { startsAt: new Date(dto.startsAt) } : {}),
        ...(dto.endsAt !== undefined
          ? { endsAt: dto.endsAt ? new Date(dto.endsAt) : null }
          : {}),
      },
      include: { ministry: true },
    });

    return toMinistryEventResponse(event);
  }

  async remove(churchId: string, eventId: string, userId: string): Promise<void> {
    const existing = await this.getEventOrThrow(churchId, eventId);
    await this.assertCanManageEvent(userId, churchId, existing);

    await this.prisma.ministryEvent.update({
      where: { id: eventId },
      data: { deletedAt: new Date() },
    });
  }

  private async getEventOrThrow(churchId: string, eventId: string) {
    const event = await this.prisma.ministryEvent.findFirst({
      where: { id: eventId, churchId, deletedAt: null },
    });

    if (!event) {
      throw new NotFoundException('Evento não encontrado.');
    }

    return event;
  }

  private async assertCanManageEvent(
    userId: string,
    churchId: string,
    event: { ministryId: string | null },
  ) {
    if (event.ministryId) {
      await this.assertCanManageMinistryEvent(userId, churchId, event.ministryId);
      return;
    }

    await this.assertCanManageChurchEvents(userId, churchId);
  }

  private async assertCanManageChurchEvents(userId: string, churchId: string) {
    const allowed = await this.churchPermissions.hasPermission(
      userId,
      churchId,
      ChurchPermission.events_create_church_wide,
    );

    if (!allowed) {
      throw new ForbiddenException(
        'Sem permissão para gerenciar atividades da igreja.',
      );
    }
  }

  private async assertCanManageMinistryEvent(
    userId: string,
    churchId: string,
    ministryId: string,
  ) {
    const ministry = await this.prisma.ministry.findFirst({
      where: { id: ministryId, churchId, isActive: true },
    });

    if (!ministry) {
      throw new NotFoundException('Ministério não encontrado.');
    }

    const allowed = await this.churchPermissions.canManageMinistryEvents(
      userId,
      churchId,
      ministryId,
    );

    if (!allowed) {
      throw new ForbiddenException(
        'Sem permissão para gerenciar atividades deste ministério.',
      );
    }
  }
}
