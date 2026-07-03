import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ChurchPermission, type MinistryEvent, type Prisma } from '@prisma/client';

import { ChurchPermissionsService } from '../../common/services/church-permissions.service';
import { PrismaService } from '../../database/prisma.service';
import {
  toMinistryEventResponse,
  type CreateMinistryEventResponse,
  type MinistryEventResponse,
} from '../ministries/ministries.types';
import { EventCreationService } from './event-creation.service';
import type { EventMutationScope } from './dto/event-mutation-scope';
import {
  CreateChurchEventDto,
  ListChurchEventsQueryDto,
  UpdateChurchEventDto,
} from './dto/event.dto';

const eventInclude = {
  ministry: true,
  recurrenceSeries: true,
} as const;

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly churchPermissions: ChurchPermissionsService,
    private readonly eventCreation: EventCreationService,
  ) {}

  async findOne(
    churchId: string,
    eventId: string,
  ): Promise<MinistryEventResponse & { seriesOccurrences: MinistryEventResponse[] }> {
    const event = await this.prisma.ministryEvent.findFirst({
      where: { id: eventId, churchId, deletedAt: null },
      include: eventInclude,
    });

    if (!event) {
      throw new NotFoundException('Evento não encontrado.');
    }

    const seriesOccurrences = event.recurrenceSeriesId
      ? (
          await this.prisma.ministryEvent.findMany({
            where: {
              churchId,
              recurrenceSeriesId: event.recurrenceSeriesId,
              deletedAt: null,
            },
            include: eventInclude,
            orderBy: { startsAt: 'asc' },
          })
        ).map(toMinistryEventResponse)
      : [];

    return {
      ...toMinistryEventResponse(event),
      seriesOccurrences,
    };
  }

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
      include: eventInclude,
      orderBy: { startsAt: 'asc' },
    });

    return events.map(toMinistryEventResponse);
  }

  async create(
    churchId: string,
    userId: string,
    dto: CreateChurchEventDto,
  ): Promise<CreateMinistryEventResponse> {
    if (dto.ministryId) {
      await this.assertCanManageMinistryEvent(
        userId,
        churchId,
        dto.ministryId,
      );
    } else {
      await this.assertCanManageChurchEvents(userId, churchId);
    }

    const { event, occurrencesCreated } = await this.eventCreation.createEvent({
      churchId,
      ministryId: dto.ministryId ?? null,
      name: dto.name,
      description: dto.description,
      location: dto.location,
      startsAt: new Date(dto.startsAt),
      endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
      createdByUserId: userId,
      recurrence: dto.recurrence,
    });

    return {
      ...toMinistryEventResponse(event),
      occurrencesCreated,
    };
  }

  async update(
    churchId: string,
    eventId: string,
    userId: string,
    dto: UpdateChurchEventDto,
  ): Promise<MinistryEventResponse> {
    const existing = await this.getEventOrThrow(churchId, eventId);
    await this.assertCanManageEvent(userId, churchId, existing);

    const scope = this.resolveScope(existing, dto.scope);
    const targets = await this.findScopeTargets(churchId, existing, scope);

    const startsDeltaMs =
      dto.startsAt !== undefined
        ? new Date(dto.startsAt).getTime() - existing.startsAt.getTime()
        : 0;

    let newDurationMs: number | null | undefined;
    if (dto.endsAt !== undefined) {
      const baseStarts =
        dto.startsAt !== undefined
          ? new Date(dto.startsAt)
          : existing.startsAt;
      newDurationMs = dto.endsAt
        ? new Date(dto.endsAt).getTime() - baseStarts.getTime()
        : null;
    }

    await this.prisma.$transaction(
      targets.map((target) => {
        const data: Prisma.MinistryEventUpdateInput = {};

        if (dto.name !== undefined) {
          data.name = dto.name.trim();
        }

        if (dto.description !== undefined) {
          data.description = dto.description;
        }

        if (dto.location !== undefined) {
          data.location = dto.location;
        }

        if (dto.startsAt !== undefined) {
          data.startsAt = new Date(target.startsAt.getTime() + startsDeltaMs);
        }

        if (dto.endsAt !== undefined) {
          const nextStarts =
            dto.startsAt !== undefined
              ? new Date(target.startsAt.getTime() + startsDeltaMs)
              : target.startsAt;

          data.endsAt =
            newDurationMs === null
              ? null
              : new Date(nextStarts.getTime() + (newDurationMs ?? 0));
        } else if (dto.startsAt !== undefined && target.endsAt) {
          data.endsAt = new Date(target.endsAt.getTime() + startsDeltaMs);
        }

        return this.prisma.ministryEvent.update({
          where: { id: target.id },
          data,
        });
      }),
    );

    const event = await this.prisma.ministryEvent.findFirstOrThrow({
      where: { id: eventId, churchId },
      include: eventInclude,
    });

    return toMinistryEventResponse(event);
  }

  async remove(
    churchId: string,
    eventId: string,
    userId: string,
    scope?: EventMutationScope,
  ): Promise<void> {
    const existing = await this.getEventOrThrow(churchId, eventId);
    await this.assertCanManageEvent(userId, churchId, existing);

    const resolvedScope = this.resolveScope(existing, scope);
    const targets = await this.findScopeTargets(
      churchId,
      existing,
      resolvedScope,
    );
    const deletedAt = new Date();

    await this.prisma.ministryEvent.updateMany({
      where: {
        id: { in: targets.map((target) => target.id) },
        churchId,
        deletedAt: null,
      },
      data: { deletedAt },
    });
  }

  private resolveScope(
    event: MinistryEvent,
    scope?: EventMutationScope,
  ): EventMutationScope {
    if (!event.recurrenceSeriesId) {
      return 'this';
    }

    return scope ?? 'this';
  }

  private async findScopeTargets(
    churchId: string,
    event: MinistryEvent,
    scope: EventMutationScope,
  ): Promise<MinistryEvent[]> {
    if (!event.recurrenceSeriesId || scope === 'this') {
      return [event];
    }

    return this.prisma.ministryEvent.findMany({
      where: {
        churchId,
        recurrenceSeriesId: event.recurrenceSeriesId,
        deletedAt: null,
        ...(scope === 'this_and_following'
          ? { startsAt: { gte: event.startsAt } }
          : {}),
      },
      orderBy: { startsAt: 'asc' },
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
