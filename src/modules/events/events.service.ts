import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ChurchPermission,
  type MinistryEvent,
  type Prisma,
} from '@prisma/client';

import { ChurchPermissionsService } from '../../common/services/church-permissions.service';
import { PrismaService } from '../../database/prisma.service';
import {
  toMinistryEventResponse,
  type CreateMinistryEventResponse,
  type EventRosterAssignmentResponse,
  type EventRosterCandidateResponse,
  type MinistryEventResponse,
} from '../ministries/ministries.types';
import { EventCreationService } from './event-creation.service';
import { syncEventRosterSlots } from './event-roster-slots';
import {
  buildVisibleEventsWhere,
  canUserViewEvent,
} from './event-visibility';
import type { EventMutationScope } from './dto/event-mutation-scope';
import {
  CreateChurchEventDto,
  ListChurchEventsQueryDto,
  UpdateChurchEventDto,
  UpsertEventRosterDto,
} from './dto/event.dto';

const eventInclude = {
  ministry: true,
  recurrenceSeries: true,
} as const;

const rosterSlotsInclude = {
  orderBy: { sortOrder: 'asc' as const },
  include: {
    assignments: {
      include: { member: true },
    },
  },
};

const eventDetailInclude = {
  ...eventInclude,
  rosterSlots: rosterSlotsInclude,
  rosterAssignments: {
    include: { member: true, rosterSlot: true },
    orderBy: { roleLabel: 'asc' as const },
  },
  availabilities: true,
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
    userId: string,
  ): Promise<
    MinistryEventResponse & {
      seriesOccurrences: MinistryEventResponse[];
      roster: EventRosterAssignmentResponse[];
      rosterCandidates: EventRosterCandidateResponse[];
      isRosterMinistry: boolean;
      usesRoster: boolean;
    }
  > {
    const event = await this.prisma.ministryEvent.findFirst({
      where: { id: eventId, churchId, deletedAt: null },
      include: eventDetailInclude,
    });

    if (!event) {
      throw new NotFoundException('Evento não encontrado.');
    }

    const canView = await canUserViewEvent(
      this.prisma,
      this.churchPermissions,
      userId,
      churchId,
      event,
    );

    if (!canView) {
      throw new NotFoundException('Evento não encontrado.');
    }

    let seriesOccurrences: MinistryEventResponse[] = [];

    if (event.recurrenceSeriesId) {
      const occurrences = await this.prisma.ministryEvent.findMany({
        where: {
          churchId,
          recurrenceSeriesId: event.recurrenceSeriesId,
          deletedAt: null,
        },
        include: eventInclude,
        orderBy: { startsAt: 'asc' },
      });

      for (const occurrence of occurrences) {
        const canViewOccurrence = await canUserViewEvent(
          this.prisma,
          this.churchPermissions,
          userId,
          churchId,
          occurrence,
        );

        if (canViewOccurrence) {
          seriesOccurrences.push(toMinistryEventResponse(occurrence));
        }
      }
    }

    const usesRoster = event.usesRoster;
    const roster = usesRoster
      ? await this.buildRosterResponse(event, event.ministryId)
      : [];
    const rosterCandidates = usesRoster
      ? await this.buildRosterCandidates(churchId, event)
      : [];

    return {
      ...toMinistryEventResponse(event),
      seriesOccurrences,
      roster,
      rosterCandidates,
      isRosterMinistry: usesRoster,
      usesRoster,
    };
  }

  async upsertRosterAssignment(
    churchId: string,
    eventId: string,
    userId: string,
    dto: UpsertEventRosterDto,
  ): Promise<EventRosterAssignmentResponse[]> {
    const event = await this.getEventOrThrow(churchId, eventId);
    await this.assertCanManageRoster(userId, churchId, event);

    if (!event.ministryId) {
      throw new BadRequestException(
        'Escala está disponível apenas para eventos de ministério.',
      );
    }

    if (!event.usesRoster) {
      throw new BadRequestException(
        'Este evento não está configurado para usar escala.',
      );
    }

    const memberLink = await this.prisma.memberMinistry.findFirst({
      where: {
        ministryId: event.ministryId,
        memberId: dto.memberId,
        endedAt: null,
        member: { churchId, deletedAt: null },
      },
    });

    if (!memberLink) {
      throw new BadRequestException(
        'Esta pessoa não faz parte deste ministério.',
      );
    }

    const eventWithAvailability = await this.prisma.ministryEvent.findFirstOrThrow({
      where: { id: eventId, churchId },
      include: { availabilities: true },
    });

    const availability = eventWithAvailability.availabilities.find(
      (item) => item.memberId === dto.memberId,
    );

    if (availability?.status !== 'available') {
      throw new BadRequestException(
        'Só é possível escalar quem marcou disponibilidade para este evento.',
      );
    }

    const slot = await this.prisma.eventRosterSlot.findFirst({
      where: {
        id: dto.rosterSlotId,
        eventId,
      },
      include: { assignments: true },
    });

    if (!slot) {
      throw new BadRequestException('Função não encontrada neste evento.');
    }

    const slotTakenByOther = slot.assignments.find(
      (assignment) => assignment.memberId !== dto.memberId,
    );

    if (slotTakenByOther) {
      throw new BadRequestException('Esta função já está preenchida na escala.');
    }

    await this.prisma.eventRosterAssignment.upsert({
      where: {
        eventId_memberId: {
          eventId,
          memberId: dto.memberId,
        },
      },
      create: {
        eventId,
        memberId: dto.memberId,
        rosterSlotId: slot.id,
        roleLabel: slot.label,
      },
      update: {
        rosterSlotId: slot.id,
        roleLabel: slot.label,
      },
    });

    const eventWithRoster = await this.prisma.ministryEvent.findFirstOrThrow({
      where: { id: eventId, churchId },
      include: {
        rosterAssignments: {
          include: { member: true, rosterSlot: true },
          orderBy: { roleLabel: 'asc' },
        },
        availabilities: true,
      },
    });

    return this.buildRosterResponse(eventWithRoster, event.ministryId);
  }

  async removeRosterAssignment(
    churchId: string,
    eventId: string,
    memberId: string,
    userId: string,
  ): Promise<EventRosterAssignmentResponse[]> {
    const event = await this.getEventOrThrow(churchId, eventId);
    await this.assertCanManageRoster(userId, churchId, event);

    await this.prisma.eventRosterAssignment.deleteMany({
      where: { eventId, memberId },
    });

    const eventWithRoster = await this.prisma.ministryEvent.findFirstOrThrow({
      where: { id: eventId, churchId },
      include: {
        rosterAssignments: {
          include: { member: true },
          orderBy: { roleLabel: 'asc' },
        },
        availabilities: true,
      },
    });

    return this.buildRosterResponse(eventWithRoster, event.ministryId);
  }

  async findAll(
    churchId: string,
    userId: string,
    query: ListChurchEventsQueryDto,
  ): Promise<MinistryEventResponse[]> {
    const visibilityWhere = await buildVisibleEventsWhere(
      this.prisma,
      this.churchPermissions,
      userId,
      churchId,
    );

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
        ...(visibilityWhere ?? {}),
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
      await this.assertCanManageMinistryEvent(userId, churchId, dto.ministryId);
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
      usesRoster: dto.ministryId ? (dto.usesRoster ?? false) : false,
      rosterOpen: dto.ministryId ? dto.rosterOpen : false,
      rosterRoles: dto.ministryId ? dto.rosterRoles : undefined,
      visibleToChurch: dto.ministryId ? dto.visibleToChurch : true,
    });

    const eventWithSlots = await this.prisma.ministryEvent.findFirstOrThrow({
      where: { id: event.id, churchId },
      include: {
        ...eventInclude,
        rosterSlots: rosterSlotsInclude,
      },
    });

    return {
      ...toMinistryEventResponse(eventWithSlots),
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
        dto.startsAt !== undefined ? new Date(dto.startsAt) : existing.startsAt;
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

        if (dto.usesRoster !== undefined) {
          data.usesRoster = dto.usesRoster;
          if (!dto.usesRoster) {
            data.rosterOpen = false;
          }
        }

        if (dto.rosterOpen !== undefined) {
          const nextUsesRoster =
            dto.usesRoster !== undefined ? dto.usesRoster : target.usesRoster;
          data.rosterOpen = nextUsesRoster ? dto.rosterOpen : false;
        }

        if (dto.visibleToChurch !== undefined && target.ministryId) {
          data.visibleToChurch = dto.visibleToChurch;
        }

        return this.prisma.ministryEvent.update({
          where: { id: target.id },
          data,
        });
      }),
    );

    if (dto.rosterRoles !== undefined) {
      for (const target of targets) {
        const usesRoster =
          dto.usesRoster !== undefined ? dto.usesRoster : target.usesRoster;

        if (usesRoster) {
          await syncEventRosterSlots(this.prisma, target.id, dto.rosterRoles);
        }
      }
    }

    const event = await this.prisma.ministryEvent.findFirstOrThrow({
      where: { id: eventId, churchId },
      include: {
        ...eventInclude,
        rosterSlots: rosterSlotsInclude,
      },
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

  private async assertCanManageRoster(
    userId: string,
    churchId: string,
    event: { ministryId: string | null },
  ) {
    if (!event.ministryId) {
      throw new BadRequestException(
        'Escala está disponível apenas para eventos de ministério.',
      );
    }

    const allowed = await this.churchPermissions.canManageMinistryRosters(
      userId,
      churchId,
      event.ministryId,
    );

    if (!allowed) {
      throw new ForbiddenException(
        'Sem permissão para gerenciar escalas deste ministério.',
      );
    }
  }

  private async assertCanManageEvent(
    userId: string,
    churchId: string,
    event: { ministryId: string | null },
  ) {
    if (event.ministryId) {
      await this.assertCanManageMinistryEvent(
        userId,
        churchId,
        event.ministryId,
      );
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

  private async buildRosterResponse(
    event: {
      rosterAssignments: Array<{
        id: string;
        eventId: string;
        memberId: string;
        rosterSlotId: string;
        roleLabel: string;
        member: { name: string };
      }>;
      availabilities: Array<{
        memberId: string;
        status: 'available' | 'unavailable';
      }>;
    },
    _ministryId: string | null,
  ): Promise<EventRosterAssignmentResponse[]> {
    return event.rosterAssignments.map((assignment) => {
      const availability = event.availabilities.find(
        (item) => item.memberId === assignment.memberId,
      );

      return {
        id: assignment.id,
        eventId: assignment.eventId,
        memberId: assignment.memberId,
        memberName: assignment.member.name,
        rosterSlotId: assignment.rosterSlotId,
        roleLabel: assignment.roleLabel,
        availabilityStatus: availability?.status ?? null,
      };
    });
  }

  private async buildRosterCandidates(
    churchId: string,
    event: {
      id: string;
      ministryId: string | null;
      availabilities: Array<{
        memberId: string;
        status: 'available' | 'unavailable';
      }>;
      rosterAssignments: Array<{ memberId: string }>;
    },
  ): Promise<EventRosterCandidateResponse[]> {
    if (!event.ministryId) {
      return [];
    }

    const assignedIds = new Set(
      event.rosterAssignments.map((item) => item.memberId),
    );

    const links = await this.prisma.memberMinistry.findMany({
      where: {
        ministryId: event.ministryId,
        endedAt: null,
        member: { churchId, deletedAt: null },
      },
      include: { member: true },
      orderBy: { member: { name: 'asc' } },
    });

    return links
      .filter((link) => !assignedIds.has(link.memberId))
      .map((link) => {
        const availability = event.availabilities.find(
          (item) => item.memberId === link.memberId,
        );

        return {
          memberId: link.memberId,
          memberName: link.member.name,
          availabilityStatus: availability?.status ?? null,
        };
      })
      .sort((a, b) => {
        const rank = (status: string | null) =>
          status === 'available' ? 0 : status === null ? 1 : 2;

        return (
          rank(a.availabilityStatus) - rank(b.availabilityStatus) ||
          a.memberName.localeCompare(b.memberName, 'pt-BR')
        );
      });
  }
}
