import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ChurchPermission,
  MemberStatus,
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
import type { UpdateEventAvailabilityDto } from '../ministries/dto/ministry.dto';
import {
  CHURCH_WIDE_DEFAULT_ROSTER_ROLE,
  filterRoleLabelsForEventSlots,
  isAllowedMemberRosterRole,
  normalizeRosterRoleValue,
} from '../ministries/roster-roles';
import { memberNeedsServiceFunctions } from '../members/member-ministry-notifications';
import { EventCreationService } from './event-creation.service';
import { syncEventRosterSlots, RosterSlotSyncError, resolveRosterSlotPlan, syncRosterCollectionState, wasRosterFullyStaffed } from './event-roster-slots';
import {
  buildVisibleEventsWhere,
  buildEventViewContext,
  canUserViewEventWithContext,
} from './event-visibility';
import type { EventMutationScope } from './dto/event-mutation-scope';
import {
  CreateChurchEventDto,
  ListChurchEventsQueryDto,
  UpdateChurchEventDto,
  UpdateEventRosterCollectionDto,
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
      roster: EventRosterAssignmentResponse[];
      rosterCandidates: EventRosterCandidateResponse[];
      isRosterMinistry: boolean;
      usesRoster: boolean;
      myAvailabilityStatus: 'available' | 'unavailable' | null;
      myRoleLabels: string[];
      needsRosterFunctions: boolean;
      canRespondToAvailability: boolean;
    }
  > {
    const [event, viewContext, viewerMember] = await Promise.all([
      this.prisma.ministryEvent.findFirst({
        where: { id: eventId, churchId, deletedAt: null },
        include: eventDetailInclude,
      }),
      buildEventViewContext(
        this.prisma,
        this.churchPermissions,
        userId,
        churchId,
      ),
      this.prisma.member.findFirst({
        where: {
          churchId,
          userId,
          deletedAt: null,
          status: MemberStatus.active,
        },
        select: { id: true },
      }),
    ]);

    if (!event) {
      throw new NotFoundException('Evento não encontrado.');
    }

    if (!canUserViewEventWithContext(event, viewContext)) {
      throw new NotFoundException('Evento não encontrado.');
    }

    const usesRoster = event.usesRoster;
    const canManageRoster = await this.canManageEventRoster(
      userId,
      churchId,
      event,
    );

    const roster = usesRoster
      ? await this.buildRosterResponse(event, event.ministryId)
      : [];
    const rosterCandidates =
      usesRoster && canManageRoster
        ? await this.buildRosterCandidates(churchId, event)
        : [];

    const myAvailability = viewerMember
      ? event.availabilities.find(
          (item) => item.memberId === viewerMember.id,
        )
      : undefined;

    let myRoleLabels = myAvailability?.roleLabels ?? [];
    let needsRosterFunctionsFlag = false;
    let canRespondToAvailability = false;

    if (viewerMember) {
      if (!event.ministryId) {
        canRespondToAvailability = true;
      } else {
        const [memberLink, serviceFunctions] = await Promise.all([
          this.prisma.memberMinistry.findFirst({
            where: {
              ministryId: event.ministryId,
              memberId: viewerMember.id,
              endedAt: null,
            },
            select: { instruments: true },
          }),
          this.prisma.ministryServiceFunction.findMany({
            where: { ministryId: event.ministryId },
            select: { id: true },
          }),
        ]);

        canRespondToAvailability = memberLink !== null;

        if (memberLink) {
          myRoleLabels = memberLink.instruments;
          needsRosterFunctionsFlag = memberNeedsServiceFunctions(
            memberLink.instruments,
            serviceFunctions,
          );
        }
      }
    }

    return {
      ...toMinistryEventResponse(event),
      roster,
      rosterCandidates,
      isRosterMinistry: usesRoster,
      usesRoster,
      myAvailabilityStatus: myAvailability?.status ?? null,
      myRoleLabels,
      needsRosterFunctions: needsRosterFunctionsFlag,
      canRespondToAvailability,
    };
  }

  async listSeriesOccurrences(
    churchId: string,
    seriesId: string,
    userId: string,
  ): Promise<
    Array<{
      id: string;
      startsAt: string;
      endsAt: string | null;
      rosterOpen: boolean;
      usesRoster: boolean;
    }>
  > {
    const viewContext = await buildEventViewContext(
      this.prisma,
      this.churchPermissions,
      userId,
      churchId,
    );

    const occurrences = await this.prisma.ministryEvent.findMany({
      where: {
        churchId,
        recurrenceSeriesId: seriesId,
        deletedAt: null,
      },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        rosterOpen: true,
        usesRoster: true,
        ministryId: true,
        visibleToChurch: true,
        ministry: { select: { isActive: true } },
      },
      orderBy: { startsAt: 'asc' },
    });

    return occurrences
      .filter((occurrence) => canUserViewEventWithContext(occurrence, viewContext))
      .map((occurrence) => ({
        id: occurrence.id,
        startsAt: occurrence.startsAt.toISOString(),
        endsAt: occurrence.endsAt?.toISOString() ?? null,
        rosterOpen: occurrence.rosterOpen,
        usesRoster: occurrence.usesRoster,
      }));
  }

  async updateMyAvailability(
    churchId: string,
    eventId: string,
    userId: string,
    dto: UpdateEventAvailabilityDto,
  ): Promise<void> {
    const member = await this.getActiveMemberForUser(churchId, userId);

    const event = await this.prisma.ministryEvent.findFirst({
      where: {
        id: eventId,
        churchId,
        ministryId: null,
        deletedAt: null,
      },
      include: {
        rosterSlots: { orderBy: { sortOrder: 'asc' } },
      },
    });

    if (!event) {
      throw new NotFoundException('Evento não encontrado.');
    }

    if (!event.usesRoster) {
      throw new BadRequestException(
        'Este evento não está configurado para coleta de disponibilidade.',
      );
    }

    if (!event.rosterOpen) {
      throw new BadRequestException(
        'A coleta de disponibilidade ainda não foi liberada para este evento.',
      );
    }

    if (event.startsAt.getTime() < Date.now()) {
      throw new BadRequestException(
        'Não é possível alterar disponibilidade de eventos passados.',
      );
    }

    if (dto.status === 'clear') {
      await this.prisma.eventAvailability.deleteMany({
        where: {
          eventId,
          memberId: member.id,
        },
      });
      return;
    }

    if (dto.status === 'available') {
      await this.prisma.eventAvailability.upsert({
        where: {
          eventId_memberId: {
            eventId,
            memberId: member.id,
          },
        },
        create: {
          eventId,
          memberId: member.id,
          status: dto.status,
          roleLabels: [],
        },
        update: {
          status: dto.status,
          roleLabels: [],
        },
      });
      return;
    }

    await this.prisma.eventAvailability.upsert({
      where: {
        eventId_memberId: {
          eventId,
          memberId: member.id,
        },
      },
      create: {
        eventId,
        memberId: member.id,
        status: dto.status,
        roleLabels: [],
      },
      update: {
        status: dto.status,
        roleLabels: [],
      },
    });
  }

  async upsertRosterAssignment(
    churchId: string,
    eventId: string,
    userId: string,
    dto: UpsertEventRosterDto,
  ): Promise<EventRosterAssignmentResponse[]> {
    const event = await this.getEventOrThrow(churchId, eventId);
    await this.assertCanManageRoster(userId, churchId, event);

    if (!event.usesRoster) {
      await this.prisma.ministryEvent.update({
        where: { id: eventId },
        data: { usesRoster: true },
      });
    }

    const member = await this.prisma.member.findFirst({
      where: {
        id: dto.memberId,
        churchId,
        deletedAt: null,
        status: MemberStatus.active,
      },
    });

    if (!member) {
      throw new BadRequestException(
        'Esta pessoa não é um membro ativo desta igreja.',
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

    const roleLabel = normalizeRosterRoleValue(dto.roleLabel);

    if (!roleLabel) {
      throw new BadRequestException('Informe a função da escala.');
    }

    if (event.ministryId) {
      const memberLink = await this.prisma.memberMinistry.findFirst({
        where: {
          ministryId: event.ministryId,
          memberId: dto.memberId,
          endedAt: null,
        },
      });

      if (!memberLink) {
        throw new BadRequestException(
          'Esta pessoa não faz parte do ministério deste evento.',
        );
      }

      if (!isAllowedMemberRosterRole(memberLink.instruments, roleLabel)) {
        throw new BadRequestException(
          'Esta pessoa não está cadastrada para servir nesta função.',
        );
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
          rosterSlotId: null,
          roleLabel,
        },
        update: {
          rosterSlotId: null,
          roleLabel,
        },
      });
    } else {
      const slots = await this.prisma.eventRosterSlot.findMany({
        where: { eventId },
        include: {
          assignments: true,
        },
      });

      if (slots.length === 0) {
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
            rosterSlotId: null,
            roleLabel,
          },
          update: {
            rosterSlotId: null,
            roleLabel,
          },
        });
      } else {
        const slot = dto.rosterSlotId
          ? slots.find((item) => item.id === dto.rosterSlotId)
          : slots.find((item) => item.label === roleLabel);

        if (!slot) {
          throw new BadRequestException('Função não encontrada neste evento.');
        }

        const availabilityRoleLabels = availability.roleLabels ?? [];

        if (
          availabilityRoleLabels.length > 0 &&
          !isAllowedMemberRosterRole(availabilityRoleLabels, slot.label)
        ) {
          throw new BadRequestException(
            'Esta pessoa não marcou disponibilidade para esta função neste evento.',
          );
        }

        const slotTakenCount = slot.assignments.filter(
          (assignment) => assignment.memberId !== dto.memberId,
        ).length;

        if (slotTakenCount >= slot.requiredCount) {
          throw new BadRequestException(
            slot.requiredCount === 1
              ? 'Esta função já está preenchida na escala.'
              : `Esta função já atingiu o limite de ${slot.requiredCount} pessoas.`,
          );
        }

        await this.prisma.$transaction(async (tx) => {
          await tx.eventRosterAssignment.upsert({
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

          await syncRosterCollectionState(tx, eventId);
        });
      }
    }

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

    const slotsBefore = await this.prisma.eventRosterSlot.findMany({
      where: { eventId },
      select: {
        requiredCount: true,
        assignments: { select: { id: true } },
      },
    });
    const wasFullyStaffed = wasRosterFullyStaffed(slotsBefore);

    await this.prisma.$transaction(async (tx) => {
      await tx.eventRosterAssignment.deleteMany({
        where: { eventId, memberId },
      });

      await syncRosterCollectionState(tx, eventId, {
        reopenOnVacancy: true,
        wasFullyStaffed,
      });
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
        // Atividades de ministérios inativos somem da lista geral; o acesso
        // continua pelo painel do ministério (que filtra por ministryId).
        ...(query.ministryId
          ? {}
          : { OR: [{ ministryId: null }, { ministry: { isActive: true } }] }),
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
      highlightNote: dto.highlightNote,
      availabilityMessage: dto.availabilityMessage,
      location: dto.location,
      startsAt: new Date(dto.startsAt),
      endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
      createdByUserId: userId,
      recurrence: dto.recurrence,
      usesRoster: dto.usesRoster ?? true,
      rosterOpen: dto.rosterOpen ?? false,
      rosterRoles: dto.rosterRoles,
      rosterSlotPlan: resolveRosterSlotPlan({
        rosterSlotPlan: dto.rosterSlotPlan,
        rosterRoles: dto.rosterRoles,
      }),
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

        if (dto.highlightNote !== undefined) {
          data.highlightNote = dto.highlightNote;
        }

        if (dto.availabilityMessage !== undefined) {
          data.availabilityMessage = dto.availabilityMessage;
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

    const rosterPlanUpdateRequested =
      dto.rosterSlotPlan !== undefined || dto.rosterRoles !== undefined;

    if (rosterPlanUpdateRequested) {
      const rosterSlotPlan = resolveRosterSlotPlan({
        rosterSlotPlan: dto.rosterSlotPlan,
        rosterRoles: dto.rosterRoles,
      });

      for (const target of targets) {
        const usesRoster =
          dto.usesRoster !== undefined ? dto.usesRoster : target.usesRoster;

        if (!usesRoster) {
          continue;
        }

        try {
          await syncEventRosterSlots(this.prisma, target.id, rosterSlotPlan);
        } catch (error) {
          if (error instanceof RosterSlotSyncError) {
            throw new BadRequestException(error.message);
          }

          throw error;
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

  async setRosterCollection(
    churchId: string,
    eventId: string,
    userId: string,
    dto: UpdateEventRosterCollectionDto,
  ): Promise<{ updated: number }> {
    const event = await this.getEventOrThrow(churchId, eventId);
    await this.assertCanManageRoster(userId, churchId, event);

    if (!dto.eventIds.length) {
      throw new BadRequestException(
        dto.rosterOpen
          ? 'Nenhuma data selecionada para abrir.'
          : 'Nenhuma data selecionada para fechar.',
      );
    }

    const now = new Date();

    const result = await this.prisma.ministryEvent.updateMany({
      where: {
        churchId,
        id: { in: dto.eventIds },
        deletedAt: null,
        startsAt: { gte: now },
        ...(event.ministryId
          ? { ministryId: event.ministryId }
          : { ministryId: null }),
      },
      data: {
        rosterOpen: dto.rosterOpen,
        ...(dto.rosterOpen ? { usesRoster: true } : {}),
      },
    });

    return { updated: result.count };
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

  private async canManageEventRoster(
    userId: string,
    churchId: string,
    event: { ministryId: string | null; createdByUserId: string | null },
  ): Promise<boolean> {
    if (event.ministryId) {
      return this.churchPermissions.canManageMinistryRosters(
        userId,
        churchId,
        event.ministryId,
      );
    }

    if (event.createdByUserId === userId) {
      return true;
    }

    return this.churchPermissions.hasPermission(
      userId,
      churchId,
      ChurchPermission.events_create_church_wide,
    );
  }

  private async assertCanManageRoster(
    userId: string,
    churchId: string,
    event: { ministryId: string | null; createdByUserId: string | null },
  ) {
    if (event.ministryId) {
      await this.assertMinistryActive(churchId, event.ministryId);

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

      return;
    }

    if (event.createdByUserId === userId) {
      return;
    }

    await this.assertCanManageChurchEvents(userId, churchId);
  }

  private async getActiveMemberForUser(churchId: string, userId: string) {
    const member = await this.prisma.member.findFirst({
      where: {
        churchId,
        userId,
        deletedAt: null,
        status: MemberStatus.active,
      },
    });

    if (!member) {
      throw new ForbiddenException(
        'Apenas membros ativos da igreja podem marcar disponibilidade.',
      );
    }

    return member;
  }

  private async assertCanManageEvent(
    userId: string,
    churchId: string,
    event: { ministryId: string | null; createdByUserId: string | null },
  ) {
    if (event.ministryId) {
      await this.assertCanManageMinistryEvent(
        userId,
        churchId,
        event.ministryId,
      );
      return;
    }

    if (event.createdByUserId === userId) {
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
    await this.assertMinistryActive(churchId, ministryId);

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

  private async assertMinistryActive(churchId: string, ministryId: string) {
    const ministry = await this.prisma.ministry.findFirst({
      where: { id: ministryId, churchId },
      select: { isActive: true },
    });

    if (!ministry) {
      throw new NotFoundException('Ministério não encontrado.');
    }

    if (!ministry.isActive) {
      throw new ForbiddenException(
        'Este ministério está inativo. Reative-o para gerenciar eventos e escalas.',
      );
    }
  }

  private async buildRosterResponse(
    event: {
      rosterAssignments: Array<{
        id: string;
        eventId: string;
        memberId: string;
        rosterSlotId: string | null;
        roleLabel: string;
        member: { name: string };
      }>;
      availabilities: Array<{
        memberId: string;
        status: 'available' | 'unavailable';
        roleLabels: string[];
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
        roleLabels: string[];
      }>;
      rosterAssignments: Array<{ memberId: string }>;
      rosterSlots: Array<{ label: string }>;
    },
  ): Promise<EventRosterCandidateResponse[]> {
    const assignedIds = new Set(
      event.rosterAssignments.map((item) => item.memberId),
    );

    const availableRows = event.availabilities.filter(
      (item) =>
        item.status === 'available' && !assignedIds.has(item.memberId),
    );

    if (availableRows.length === 0) {
      return [];
    }

    const memberIds = availableRows.map((item) => item.memberId);
    const availabilityByMemberId = new Map(
      availableRows.map((item) => [item.memberId, item]),
    );

    if (event.ministryId) {
      const links = await this.prisma.memberMinistry.findMany({
        where: {
          ministryId: event.ministryId,
          memberId: { in: memberIds },
          endedAt: null,
          member: {
            churchId,
            deletedAt: null,
            status: MemberStatus.active,
          },
        },
        include: { member: true },
        orderBy: { member: { name: 'asc' } },
      });

      return links
        .map((link) => {
          const availability = availabilityByMemberId.get(link.memberId)!;

          return {
            memberId: link.memberId,
            memberName: link.member.name,
            availabilityStatus: availability.status,
            roleLabels: link.instruments ?? [],
          };
        })
        .sort((a, b) => this.compareRosterCandidates(a, b));
    }

    const members = await this.prisma.member.findMany({
      where: {
        id: { in: memberIds },
        churchId,
        deletedAt: null,
        status: MemberStatus.active,
      },
      orderBy: { name: 'asc' },
    });

    const eventSlotLabels = event.rosterSlots.map((slot) => slot.label);
    const fallbackRoleLabels =
      eventSlotLabels.length > 0
        ? eventSlotLabels
        : [CHURCH_WIDE_DEFAULT_ROSTER_ROLE];

    return members
      .map((member) => {
        const availability = availabilityByMemberId.get(member.id)!;
        const storedRoleLabels = availability.roleLabels ?? [];
        const roleLabels =
          storedRoleLabels.length > 0 ? storedRoleLabels : fallbackRoleLabels;

        return {
          memberId: member.id,
          memberName: member.name,
          availabilityStatus: availability.status,
          roleLabels,
        };
      })
      .sort((a, b) => this.compareRosterCandidates(a, b));
  }

  private compareRosterCandidates(
    a: EventRosterCandidateResponse,
    b: EventRosterCandidateResponse,
  ): number {
    const rank = (status: string | null) =>
      status === 'available' ? 0 : status === null ? 1 : 2;

    return (
      rank(a.availabilityStatus) - rank(b.availabilityStatus) ||
      a.memberName.localeCompare(b.memberName, 'pt-BR')
    );
  }
}
