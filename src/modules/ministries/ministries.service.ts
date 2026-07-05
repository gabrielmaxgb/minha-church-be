import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { WorshipAvailabilityPeriod } from '@prisma/client';
import { ChurchPermission } from '@prisma/client';

import { ChurchPermissionsService } from '../../common/services/church-permissions.service';
import { PrismaService } from '../../database/prisma.service';
import { EventCreationService } from '../events/event-creation.service';
import { EventsService } from '../events/events.service';
import type { EventMutationScope } from '../events/dto/event-mutation-scope';
import { UsersService } from '../users/users.service';
import {
  CreateMinistryDto,
  CreateMinistryEventDto,
  CreateMinistryRoleDto,
  ListMinistryEventsQueryDto,
  UpdateEventAvailabilityDto,
  UpdateMinistryDto,
  UpdateMinistryEventDto,
  UpdateMinistryRoleDto,
  UpdateRosterProfileDto,
  type OpenAvailabilityWindowDto,
} from './dto/ministry.dto';
import {
  computePeriodBounds,
  defaultPeriodStart,
  formatDateOnly,
  formatPeriodLabel,
  isEventInAvailabilityWindow,
  parseDateOnly,
} from './worship-availability-window';
import {
  toMinistryEventResponse,
  toMinistryResponse,
  toMinistryRoleResponse,
  type CreateMinistryEventResponse,
  type MinistryEventResponse,
  type MinistryMemberResponse,
  type MinistryResponse,
  type MinistryRoleResponse,
  type MyScheduleEventResponse,
  type MySchedulesResponse,
  type RosterAvailabilityWindowResponse,
  type RosterProfileResponse,
} from './ministries.types';

@Injectable()
export class MinistriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly churchPermissions: ChurchPermissionsService,
    private readonly eventCreation: EventCreationService,
    private readonly eventsService: EventsService,
  ) {}

  async findAll(churchId: string, userId: string): Promise<MinistryResponse[]> {
    const canManageAll = await this.churchPermissions.hasPermission(
      userId,
      churchId,
      ChurchPermission.ministries_manage,
    );

    const ministries = await this.prisma.ministry.findMany({
      where: canManageAll
        ? { churchId }
        : {
            churchId,
            members: {
              some: {
                endedAt: null,
                member: {
                  userId,
                  churchId,
                  deletedAt: null,
                },
              },
            },
          },
      include: { roles: true },
      orderBy: { name: 'asc' },
    });

    return ministries.map(toMinistryResponse);
  }

  async findOne(
    churchId: string,
    ministryId: string,
    userId: string,
  ): Promise<MinistryResponse> {
    const ministry = await this.getMinistryOrThrow(churchId, ministryId);

    const canManageAll = await this.churchPermissions.hasPermission(
      userId,
      churchId,
      ChurchPermission.ministries_manage,
    );

    if (!canManageAll) {
      const link = await this.prisma.memberMinistry.findFirst({
        where: {
          ministryId,
          endedAt: null,
          member: {
            churchId,
            userId,
            deletedAt: null,
          },
        },
      });

      if (!link) {
        throw new ForbiddenException('Você não faz parte deste ministério.');
      }
    }

    const availabilityWindow = await this.buildAvailabilityWindowResponse(
      churchId,
      ministry,
    );

    return {
      ...toMinistryResponse(ministry),
      availabilityWindow,
    };
  }

  async create(
    churchId: string,
    dto: CreateMinistryDto,
  ): Promise<MinistryResponse> {
    await this.ensureMinistryNameAvailable(churchId, dto.name);

    const ministry = await this.prisma.ministry.create({
      data: {
        churchId,
        name: dto.name.trim(),
        description: dto.description,
        hasRoster: dto.hasRoster ?? false,
      },
      include: { roles: true },
    });

    return toMinistryResponse(ministry);
  }

  async openAvailabilityWindow(
    churchId: string,
    ministryId: string,
    userId: string,
    dto: OpenAvailabilityWindowDto,
  ): Promise<RosterAvailabilityWindowResponse> {
    await this.getRosterMinistryOrThrow(churchId, ministryId);
    await this.assertCanManageEvents(userId, churchId, ministryId);

    const anchor = dto.startDate
      ? parseDateOnly(dto.startDate)
      : defaultPeriodStart(dto.periodType);
    const { start, end } = computePeriodBounds(dto.periodType, anchor);

    await this.prisma.ministry.update({
      where: { id: ministryId },
      data: {
        availabilityWindowActive: true,
        availabilityPeriodType: dto.periodType,
        availabilityPeriodStart: start,
        availabilityPeriodEnd: end,
      },
    });

    await this.prisma.ministryEvent.updateMany({
      where: {
        churchId,
        ministryId,
        deletedAt: null,
        startsAt: { gte: start, lte: end },
      },
      data: { rosterOpen: true },
    });

    await this.prisma.ministryEvent.updateMany({
      where: {
        churchId,
        ministryId,
        deletedAt: null,
        OR: [{ startsAt: { lt: start } }, { startsAt: { gt: end } }],
      },
      data: { rosterOpen: false },
    });

    const updated = await this.getRosterMinistryOrThrow(churchId, ministryId);
    return (await this.buildAvailabilityWindowResponse(churchId, updated))!;
  }

  async closeAvailabilityWindow(
    churchId: string,
    ministryId: string,
    userId: string,
  ): Promise<RosterAvailabilityWindowResponse> {
    await this.getRosterMinistryOrThrow(churchId, ministryId);
    await this.assertCanManageEvents(userId, churchId, ministryId);

    await this.prisma.ministry.update({
      where: { id: ministryId },
      data: {
        availabilityWindowActive: false,
        availabilityPeriodType: null,
        availabilityPeriodStart: null,
        availabilityPeriodEnd: null,
      },
    });

    await this.prisma.ministryEvent.updateMany({
      where: { churchId, ministryId, deletedAt: null },
      data: { rosterOpen: false },
    });

    const updated = await this.getRosterMinistryOrThrow(churchId, ministryId);
    return (await this.buildAvailabilityWindowResponse(churchId, updated))!;
  }

  async update(
    churchId: string,
    ministryId: string,
    dto: UpdateMinistryDto,
  ): Promise<MinistryResponse> {
    const existing = await this.getMinistryOrThrow(churchId, ministryId);

    if (dto.name && dto.name !== existing.name) {
      await this.ensureMinistryNameAvailable(churchId, dto.name, ministryId);
    }

    const ministry = await this.prisma.ministry.update({
      where: { id: ministryId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description }
          : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.hasRoster !== undefined ? { hasRoster: dto.hasRoster } : {}),
      },
      include: { roles: true },
    });

    return toMinistryResponse(ministry);
  }

  async remove(churchId: string, ministryId: string): Promise<void> {
    await this.getMinistryOrThrow(churchId, ministryId);

    await this.prisma.ministry.delete({
      where: { id: ministryId },
    });
  }

  async listRoles(
    churchId: string,
    ministryId: string,
  ): Promise<MinistryRoleResponse[]> {
    await this.getMinistryOrThrow(churchId, ministryId);

    const roles = await this.prisma.ministryRole.findMany({
      where: { ministryId },
      orderBy: { sortOrder: 'asc' },
    });

    return roles.map(toMinistryRoleResponse);
  }

  async createRole(
    churchId: string,
    ministryId: string,
    dto: CreateMinistryRoleDto,
  ): Promise<MinistryRoleResponse> {
    await this.getMinistryOrThrow(churchId, ministryId);
    await this.ensureRoleNameAvailable(ministryId, dto.name);

    const role = await this.prisma.ministryRole.create({
      data: {
        ministryId,
        name: dto.name.trim(),
        sortOrder: dto.sortOrder ?? 0,
        canManageEvents: dto.canManageEvents ?? false,
        canManageRoster: dto.canManageRoster ?? false,
      },
    });

    return toMinistryRoleResponse(role);
  }

  async updateRole(
    churchId: string,
    ministryId: string,
    roleId: string,
    dto: UpdateMinistryRoleDto,
  ): Promise<MinistryRoleResponse> {
    await this.getMinistryOrThrow(churchId, ministryId);
    const existing = await this.getRoleOrThrow(ministryId, roleId);

    if (dto.name && dto.name !== existing.name) {
      await this.ensureRoleNameAvailable(ministryId, dto.name, roleId);
    }

    const role = await this.prisma.ministryRole.update({
      where: { id: roleId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.canManageEvents !== undefined
          ? { canManageEvents: dto.canManageEvents }
          : {}),
        ...(dto.canManageRoster !== undefined
          ? { canManageRoster: dto.canManageRoster }
          : {}),
      },
    });

    return toMinistryRoleResponse(role);
  }

  async removeRole(
    churchId: string,
    ministryId: string,
    roleId: string,
  ): Promise<void> {
    await this.getMinistryOrThrow(churchId, ministryId);
    await this.getRoleOrThrow(ministryId, roleId);

    await this.prisma.ministryRole.delete({ where: { id: roleId } });
  }

  async listMembers(
    churchId: string,
    ministryId: string,
  ): Promise<MinistryMemberResponse[]> {
    await this.getMinistryOrThrow(churchId, ministryId);

    const links = await this.prisma.memberMinistry.findMany({
      where: {
        ministryId,
        endedAt: null,
        member: { churchId, deletedAt: null },
      },
      include: {
        member: true,
        roleAssignments: {
          include: {
            ministryRole: true,
          },
        },
      },
      orderBy: { member: { name: 'asc' } },
    });

    return links.map((link) => {
      const roles = link.roleAssignments
        .map((assignment) => ({
          id: assignment.ministryRole.id,
          name: assignment.ministryRole.name,
          canManageEvents: assignment.ministryRole.canManageEvents,
          sortOrder: assignment.ministryRole.sortOrder,
        }))
        .sort(
          (a, b) =>
            a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'pt-BR'),
        )
        .map(({ id, name, canManageEvents }) => ({
          id,
          name,
          canManageEvents,
        }));

      return {
        id: link.id,
        memberId: link.memberId,
        memberName: link.member.name,
        memberEmail: link.member.email,
        memberPhone: link.member.phone,
        instruments: link.instruments,
        roles,
        canManageEvents: roles.some((role) => role.canManageEvents),
        startedAt: link.startedAt?.toISOString() ?? null,
      };
    });
  }

  async getMySchedules(
    churchId: string,
    userId: string,
  ): Promise<MySchedulesResponse> {
    const empty: MySchedulesResponse = {
      hasRosterMinistries: false,
      summary: {
        pendingAvailabilityCount: 0,
        upcomingAssignmentsCount: 0,
        missingRosterFunctionsCount: 0,
        nextAssignment: null,
      },
      ministries: [],
    };

    const member = await this.prisma.member.findFirst({
      where: {
        churchId,
        userId,
        deletedAt: null,
      },
    });

    if (!member) {
      return empty;
    }

    const rosterLinks = await this.prisma.memberMinistry.findMany({
      where: {
        memberId: member.id,
        endedAt: null,
        ministry: {
          churchId,
          isActive: true,
          hasRoster: true,
        },
      },
      include: { ministry: true },
    });

    if (rosterLinks.length === 0) {
      return empty;
    }

    const ministryIds = rosterLinks.map((link) => link.ministryId);
    const now = new Date();

    const futureEvents = await this.prisma.ministryEvent.findMany({
      where: {
        churchId,
        ministryId: { in: ministryIds },
        deletedAt: null,
        startsAt: { gte: now },
      },
      include: {
        ministry: true,
        availabilities: true,
        rosterAssignments: {
          include: {
            member: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { startsAt: 'asc' },
      take: 90,
    });

    const scheduleEvents: MyScheduleEventResponse[] = [];

    for (const event of futureEvents) {
      if (!event.ministryId || !event.ministry) {
        continue;
      }

      const mapped = this.mapMyScheduleEvent(
        {
          ...event,
          ministry: event.ministry,
        },
        member.id,
        event.ministry,
      );

      if (mapped) {
        scheduleEvents.push(mapped);
      }
    }

    const pendingAvailability = scheduleEvents
      .filter(
        (event) =>
          event.rosterOpen &&
          event.myAvailabilityStatus === null &&
          event.myRoleLabel === null,
      )
      .map((event) => ({
        eventId: event.eventId,
        ministryId: event.ministryId,
        ministryName: event.ministryName,
        name: event.name,
        startsAt: event.startsAt,
        location: event.location,
      }));

    const upcomingAssignments = scheduleEvents
      .filter((event) => event.myRoleLabel !== null)
      .map((event) => ({
        eventId: event.eventId,
        ministryId: event.ministryId,
        ministryName: event.ministryName,
        name: event.name,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        location: event.location,
        roleLabel: event.myRoleLabel!,
      }));

    const ministries = await Promise.all(
      rosterLinks.map(async (link) => {
        const window = await this.buildAvailabilityWindowResponse(
          churchId,
          link.ministry,
        );
        const ministryEvents = scheduleEvents.filter(
          (event) => event.ministryId === link.ministryId,
        );

        return {
          ministryId: link.ministry.id,
          ministryName: link.ministry.name,
          availabilityWindow: {
            active: window?.active ?? false,
            periodType: window?.periodType ?? null,
            periodStart: window?.periodStart ?? null,
            periodEnd: window?.periodEnd ?? null,
            label: window?.label ?? null,
          },
          events: ministryEvents,
          pendingAvailability: pendingAvailability.filter(
            (item) => item.ministryId === link.ministryId,
          ),
          upcomingAssignments: upcomingAssignments.filter(
            (item) => item.ministryId === link.ministryId,
          ),
          rosterFunctions: link.instruments,
          needsRosterFunctions: link.instruments.every(
            (item) => !item.trim(),
          ),
        };
      }),
    );

    return {
      hasRosterMinistries: true,
      summary: {
        pendingAvailabilityCount: pendingAvailability.length,
        upcomingAssignmentsCount: upcomingAssignments.length,
        missingRosterFunctionsCount: ministries.filter(
          (ministry) => ministry.needsRosterFunctions,
        ).length,
        nextAssignment: upcomingAssignments[0] ?? null,
      },
      ministries,
    };
  }

  private mapMyScheduleEvent(
    event: {
      id: string;
      ministryId: string | null;
      name: string;
      startsAt: Date;
      endsAt: Date | null;
      location: string | null;
      ministry: {
        id: string;
        name: string;
        availabilityWindowActive: boolean;
        availabilityPeriodStart: Date | null;
        availabilityPeriodEnd: Date | null;
      };
      availabilities: Array<{
        memberId: string;
        status: 'available' | 'unavailable';
      }>;
      rosterAssignments: Array<{
        memberId: string;
        roleLabel: string;
        member: { id: string; name: string };
      }>;
    },
    memberId: string,
    ministry: {
      availabilityWindowActive: boolean;
      availabilityPeriodStart: Date | null;
      availabilityPeriodEnd: Date | null;
    },
  ): MyScheduleEventResponse | null {
    const myAssignment = event.rosterAssignments.find(
      (assignment) => assignment.memberId === memberId,
    );
    const myAvailability = event.availabilities.find(
      (availability) => availability.memberId === memberId,
    );
    const rosterOpen = isEventInAvailabilityWindow(event.startsAt, ministry);

    if (!myAssignment && !myAvailability && !rosterOpen) {
      return null;
    }

    return {
      eventId: event.id,
      ministryId: event.ministryId!,
      ministryName: event.ministry.name,
      name: event.name,
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt?.toISOString() ?? null,
      location: event.location,
      rosterOpen,
      myAvailabilityStatus: myAvailability?.status ?? null,
      myRoleLabel: myAssignment?.roleLabel ?? null,
      roster: event.rosterAssignments
        .slice()
        .sort((left, right) =>
          left.member.name.localeCompare(right.member.name, 'pt-BR'),
        )
        .map((assignment) => ({
          memberId: assignment.memberId,
          memberName: assignment.member.name,
          roleLabel: assignment.roleLabel,
        })),
    };
  }

  async getRosterProfile(
    churchId: string,
    ministryId: string,
    userId: string,
  ): Promise<RosterProfileResponse> {
    const ministry = await this.getRosterMinistryOrThrow(churchId, ministryId);
    const memberLink = await this.getActiveMinistryMemberLink(
      churchId,
      ministryId,
      userId,
    );

    const teamSize = await this.prisma.memberMinistry.count({
      where: {
        ministryId,
        endedAt: null,
        member: { churchId, deletedAt: null },
      },
    });

    const availabilityWindow = (await this.buildAvailabilityWindowResponse(
      churchId,
      ministry,
    ))!;

    const now = new Date();
    const periodStart =
      ministry.availabilityWindowActive && ministry.availabilityPeriodStart
        ? ministry.availabilityPeriodStart > now
          ? ministry.availabilityPeriodStart
          : now
        : null;

    const events =
      ministry.availabilityWindowActive &&
      ministry.availabilityPeriodStart &&
      ministry.availabilityPeriodEnd
        ? await this.prisma.ministryEvent.findMany({
            where: {
              churchId,
              ministryId,
              deletedAt: null,
              startsAt: {
                gte: periodStart ?? ministry.availabilityPeriodStart,
                lte: ministry.availabilityPeriodEnd,
              },
            },
            include: {
              availabilities: true,
            },
            orderBy: { startsAt: 'asc' },
            take: 40,
          })
        : [];

    const upcomingEvents = events.map((event) => {
      const myAvailability = event.availabilities.find(
        (item) => item.memberId === memberLink.memberId,
      );
      const availableCount = event.availabilities.filter(
        (item) => item.status === 'available',
      ).length;
      const unavailableCount = event.availabilities.filter(
        (item) => item.status === 'unavailable',
      ).length;
      const inWindow = isEventInAvailabilityWindow(event.startsAt, ministry);

      return {
        id: event.id,
        name: event.name,
        startsAt: event.startsAt.toISOString(),
        endsAt: event.endsAt?.toISOString() ?? null,
        location: event.location,
        recurrenceSeriesId: event.recurrenceSeriesId,
        isRecurring: Boolean(event.recurrenceSeriesId),
        rosterOpen: inWindow,
        myStatus: myAvailability?.status ?? null,
        availableCount,
        unavailableCount,
        pendingCount: Math.max(teamSize - availableCount - unavailableCount, 0),
      };
    });

    const seriesMap = new Map<
      string,
      {
        key: string;
        name: string;
        isRecurring: boolean;
        occurrences: typeof upcomingEvents;
      }
    >();

    for (const event of upcomingEvents) {
      const key = event.recurrenceSeriesId ?? `single:${event.id}`;
      const group = seriesMap.get(key);

      if (group) {
        group.occurrences.push(event);
      } else {
        seriesMap.set(key, {
          key,
          name: event.name,
          isRecurring: event.isRecurring,
          occurrences: [event],
        });
      }
    }

    const series = [...seriesMap.values()].map((group) => {
      const openOccurrences = group.occurrences.filter(
        (item) => item.rosterOpen,
      );

      return {
        key: group.key,
        name: group.name,
        isRecurring: group.isRecurring,
        openCount: openOccurrences.length,
        myAvailableCount: openOccurrences.filter(
          (item) => item.myStatus === 'available',
        ).length,
        myUnavailableCount: openOccurrences.filter(
          (item) => item.myStatus === 'unavailable',
        ).length,
        myPendingCount: openOccurrences.filter((item) => item.myStatus === null)
          .length,
        occurrences: group.occurrences,
      };
    });

    const openEvents = upcomingEvents.filter((event) => event.rosterOpen);
    const available = openEvents.filter(
      (event) => event.myStatus === 'available',
    ).length;
    const unavailable = openEvents.filter(
      (event) => event.myStatus === 'unavailable',
    ).length;

    return {
      ministryId: ministry.id,
      ministryName: ministry.name,
      hasRoster: true,
      memberId: memberLink.memberId,
      instruments: memberLink.instruments,
      needsRosterFunctions: memberLink.instruments.every((item) => !item.trim()),
      availabilityWindow,
      series,
      summary: {
        totalOpen: openEvents.length,
        available,
        unavailable,
        pending: openEvents.length - available - unavailable,
      },
    };
  }

  async updateRosterProfile(
    churchId: string,
    ministryId: string,
    userId: string,
    dto: UpdateRosterProfileDto,
  ): Promise<RosterProfileResponse> {
    await this.getRosterMinistryOrThrow(churchId, ministryId);
    const memberLink = await this.getActiveMinistryMemberLink(
      churchId,
      ministryId,
      userId,
    );

    await this.prisma.memberMinistry.update({
      where: { id: memberLink.id },
      data: {
        instruments: dto.instruments.map((item) => item.trim()).filter(Boolean),
      },
    });

    return this.getRosterProfile(churchId, ministryId, userId);
  }

  async updateMyEventAvailability(
    churchId: string,
    ministryId: string,
    eventId: string,
    userId: string,
    dto: UpdateEventAvailabilityDto,
  ): Promise<RosterProfileResponse> {
    await this.getRosterMinistryOrThrow(churchId, ministryId);
    const memberLink = await this.getActiveMinistryMemberLink(
      churchId,
      ministryId,
      userId,
    );

    const event = await this.prisma.ministryEvent.findFirst({
      where: {
        id: eventId,
        churchId,
        ministryId,
        deletedAt: null,
      },
    });

    if (!event) {
      throw new NotFoundException('Evento não encontrado.');
    }

    const ministry = await this.getRosterMinistryOrThrow(churchId, ministryId);

    if (!isEventInAvailabilityWindow(event.startsAt, ministry)) {
      throw new BadRequestException(
        'Este evento está fora do período aberto para coleta de disponibilidade.',
      );
    }

    if (event.startsAt.getTime() < Date.now()) {
      throw new BadRequestException(
        'Não é possível alterar disponibilidade de eventos passados.',
      );
    }

    const hasRosterFunctions = memberLink.instruments.some((item) =>
      item.trim(),
    );

    if (dto.status !== 'clear' && !hasRosterFunctions) {
      throw new BadRequestException(
        'Cadastre pelo menos uma função na escala antes de informar disponibilidade.',
      );
    }

    if (dto.status === 'clear') {
      await this.prisma.eventAvailability.deleteMany({
        where: {
          eventId,
          memberId: memberLink.memberId,
        },
      });
    } else {
      await this.prisma.eventAvailability.upsert({
        where: {
          eventId_memberId: {
            eventId,
            memberId: memberLink.memberId,
          },
        },
        create: {
          eventId,
          memberId: memberLink.memberId,
          status: dto.status,
        },
        update: {
          status: dto.status,
        },
      });
    }

    return this.getRosterProfile(churchId, ministryId, userId);
  }

  private async getRosterMinistryOrThrow(churchId: string, ministryId: string) {
    const ministry = await this.getMinistryOrThrow(churchId, ministryId);

    if (!ministry.hasRoster) {
      throw new BadRequestException(
        'Este recurso está disponível apenas para ministérios com escalas.',
      );
    }

    return ministry;
  }

  private async getActiveMinistryMemberLink(
    churchId: string,
    ministryId: string,
    userId: string,
  ) {
    const member = await this.prisma.member.findFirst({
      where: {
        churchId,
        userId,
        deletedAt: null,
      },
    });

    if (!member) {
      throw new ForbiddenException(
        'Seu usuário não está vinculado a um cadastro pastoral nesta igreja.',
      );
    }

    const link = await this.prisma.memberMinistry.findFirst({
      where: {
        ministryId,
        memberId: member.id,
        endedAt: null,
      },
    });

    if (!link) {
      throw new ForbiddenException(
        'Você precisa fazer parte deste ministério para marcar disponibilidade.',
      );
    }

    return link;
  }

  async listEvents(
    churchId: string,
    ministryId: string,
    query: ListMinistryEventsQueryDto,
  ): Promise<MinistryEventResponse[]> {
    await this.getMinistryOrThrow(churchId, ministryId);

    const events = await this.prisma.ministryEvent.findMany({
      where: {
        churchId,
        ministryId,
        deletedAt: null,
        ...(query.from ? { startsAt: { gte: new Date(query.from) } } : {}),
        ...(query.to
          ? { startsAt: { lte: new Date(`${query.to}T23:59:59.999Z`) } }
          : {}),
      },
      include: { ministry: true, recurrenceSeries: true },
      orderBy: { startsAt: 'asc' },
    });

    return events.map(toMinistryEventResponse);
  }

  async createEvent(
    churchId: string,
    ministryId: string,
    userId: string,
    dto: CreateMinistryEventDto,
  ): Promise<CreateMinistryEventResponse> {
    const ministry = await this.getMinistryOrThrow(churchId, ministryId);
    await this.assertCanManageEvents(userId, churchId, ministryId);

    const rosterOpen = dto.rosterOpen ?? ministry.hasRoster;

    const { event, occurrencesCreated } = await this.eventCreation.createEvent({
      churchId,
      ministryId,
      name: dto.name,
      description: dto.description,
      location: dto.location,
      startsAt: new Date(dto.startsAt),
      endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
      createdByUserId: userId,
      recurrence: dto.recurrence,
      rosterOpen,
    });

    return {
      ...toMinistryEventResponse(event),
      occurrencesCreated,
    };
  }

  async updateEvent(
    churchId: string,
    ministryId: string,
    eventId: string,
    userId: string,
    dto: UpdateMinistryEventDto,
  ): Promise<MinistryEventResponse> {
    await this.getMinistryOrThrow(churchId, ministryId);
    await this.assertCanManageEvents(userId, churchId, ministryId);
    await this.getEventOrThrow(churchId, ministryId, eventId);

    return this.eventsService.update(churchId, eventId, userId, dto);
  }

  async removeEvent(
    churchId: string,
    ministryId: string,
    eventId: string,
    userId: string,
    scope?: EventMutationScope,
  ): Promise<void> {
    await this.getMinistryOrThrow(churchId, ministryId);
    await this.assertCanManageEvents(userId, churchId, ministryId);
    await this.getEventOrThrow(churchId, ministryId, eventId);

    await this.eventsService.remove(churchId, eventId, userId, scope);
  }

  private async assertCanManageEvents(
    userId: string,
    churchId: string,
    ministryId: string,
  ) {
    const allowed = await this.churchPermissions.canManageMinistryEvents(
      userId,
      churchId,
      ministryId,
    );

    if (!allowed) {
      throw new ForbiddenException(
        'Sem permissão para gerenciar eventos deste ministério.',
      );
    }
  }

  private async getMinistryOrThrow(churchId: string, ministryId: string) {
    const ministry = await this.prisma.ministry.findFirst({
      where: { id: ministryId, churchId },
      include: { roles: true },
    });

    if (!ministry) {
      throw new NotFoundException('Ministério não encontrado.');
    }

    return ministry;
  }

  private async getRoleOrThrow(ministryId: string, roleId: string) {
    const role = await this.prisma.ministryRole.findFirst({
      where: { id: roleId, ministryId },
    });

    if (!role) {
      throw new NotFoundException('Cargo do ministério não encontrado.');
    }

    return role;
  }

  private async getEventOrThrow(
    churchId: string,
    ministryId: string,
    eventId: string,
  ) {
    const event = await this.prisma.ministryEvent.findFirst({
      where: {
        id: eventId,
        churchId,
        ministryId,
        deletedAt: null,
      },
    });

    if (!event) {
      throw new NotFoundException('Evento não encontrado.');
    }

    return event;
  }

  private async ensureMinistryNameAvailable(
    churchId: string,
    name: string,
    excludeId?: string,
  ) {
    const existing = await this.prisma.ministry.findFirst({
      where: {
        churchId,
        name: { equals: name.trim(), mode: 'insensitive' },
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
    });

    if (existing) {
      throw new ConflictException('Já existe um ministério com este nome.');
    }
  }

  private async ensureRoleNameAvailable(
    ministryId: string,
    name: string,
    excludeId?: string,
  ) {
    const existing = await this.prisma.ministryRole.findFirst({
      where: {
        ministryId,
        name: { equals: name.trim(), mode: 'insensitive' },
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
    });

    if (existing) {
      throw new ConflictException(
        'Já existe um cargo com este nome no ministério.',
      );
    }
  }

  private async buildAvailabilityWindowResponse(
    churchId: string,
    ministry: {
      id: string;
      hasRoster: boolean;
      availabilityWindowActive: boolean;
      availabilityPeriodType: string | null;
      availabilityPeriodStart: Date | null;
      availabilityPeriodEnd: Date | null;
    },
  ): Promise<RosterAvailabilityWindowResponse | null> {
    if (!ministry.hasRoster) {
      return null;
    }

    const base: RosterAvailabilityWindowResponse = {
      active: ministry.availabilityWindowActive,
      periodType: (ministry.availabilityPeriodType ??
        null) as RosterAvailabilityWindowResponse['periodType'],
      periodStart: ministry.availabilityPeriodStart
        ? formatDateOnly(ministry.availabilityPeriodStart)
        : null,
      periodEnd: ministry.availabilityPeriodEnd
        ? formatDateOnly(ministry.availabilityPeriodEnd)
        : null,
      label:
        ministry.availabilityWindowActive &&
        ministry.availabilityPeriodType &&
        ministry.availabilityPeriodStart &&
        ministry.availabilityPeriodEnd
          ? formatPeriodLabel(
              ministry.availabilityPeriodType as WorshipAvailabilityPeriod,
              ministry.availabilityPeriodStart,
              ministry.availabilityPeriodEnd,
            )
          : null,
      eventsInPeriod: 0,
      teamPendingCount: 0,
    };

    if (
      !ministry.availabilityWindowActive ||
      !ministry.availabilityPeriodStart ||
      !ministry.availabilityPeriodEnd
    ) {
      return base;
    }

    const [eventsInPeriod, teamSize, respondedCount] = await Promise.all([
      this.prisma.ministryEvent.count({
        where: {
          churchId,
          ministryId: ministry.id,
          deletedAt: null,
          startsAt: {
            gte: ministry.availabilityPeriodStart,
            lte: ministry.availabilityPeriodEnd,
          },
        },
      }),
      this.prisma.memberMinistry.count({
        where: {
          ministryId: ministry.id,
          endedAt: null,
          member: { churchId, deletedAt: null },
        },
      }),
      this.prisma.eventAvailability.count({
        where: {
          event: {
            churchId,
            ministryId: ministry.id,
            deletedAt: null,
            startsAt: {
              gte: ministry.availabilityPeriodStart,
              lte: ministry.availabilityPeriodEnd,
            },
          },
        },
      }),
    ]);

    const maxResponses = eventsInPeriod * teamSize;

    return {
      ...base,
      eventsInPeriod,
      teamPendingCount: Math.max(maxResponses - respondedCount, 0),
    };
  }
}
