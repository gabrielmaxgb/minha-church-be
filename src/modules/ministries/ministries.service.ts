import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ChurchPermission, MemberStatus } from '@prisma/client';

import { ChurchPermissionsService } from '../../common/services/church-permissions.service';
import { PrismaService } from '../../database/prisma.service';
import { EventCreationService } from '../events/event-creation.service';
import { resolveRosterSlotPlan } from '../events/event-roster-slots';
import { EventsService } from '../events/events.service';
import type { EventMutationScope } from '../events/dto/event-mutation-scope';
import { memberNeedsServiceFunctions } from '../members/member-ministry-notifications';
import { UsersService } from '../users/users.service';
import {
  CreateMinistryDto,
  CreateMinistryEventDto,
  CreateMinistryRoleDto,
  ListMinistryEventsQueryDto,
  UpdateEventAvailabilityDto,
  UpdateEventRoleProfileDto,
  UpdateMinistryDto,
  UpdateMinistryEventDto,
  UpdateMinistryRoleDto,
  UpdateRosterProfileDto,
  UpdateRosterCollectionDto,
  ReplaceMinistryServiceFunctionsDto,
  UpdateMemberMinistryInstrumentsDto,
} from './dto/ministry.dto';
import {
  ensureMemberMinistryInstruments,
  listMinistryServiceFunctions,
  replaceMinistryServiceFunctions,
} from './ministry-service-functions';
import {
  DEFAULT_MINISTRY_SERVICE_FUNCTION,
  filterRoleLabelsForEventSlots,
  isAllowedMemberRosterRole,
  needsRosterFunctions,
  normalizeRosterRoleValue,
  resolveEventProfileKey,
} from './roster-roles';
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
  type RosterProfileResponse,
} from './ministries.types';

export const CHURCH_WIDE_SCHEDULE_ID = 'igreja';

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
    const canManageAll =
      (await this.churchPermissions.hasPermission(
        userId,
        churchId,
        ChurchPermission.ministries_manage,
      )) ||
      (await this.churchPermissions.hasPermission(
        userId,
        churchId,
        ChurchPermission.communication_manage,
      ));

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
      include: { roles: true, serviceFunctions: true },
      orderBy: { name: 'asc' },
    });

    return ministries.map((ministry) =>
      toMinistryResponse({ ...ministry, serviceFunctions: [] }),
    );
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

    return toMinistryResponse(ministry);
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
        serviceFunctions: {
          create: {
            label: DEFAULT_MINISTRY_SERVICE_FUNCTION,
            sortOrder: 0,
          },
        },
      },
      include: { roles: true, serviceFunctions: true },
    });

    return toMinistryResponse(ministry);
  }

  async setRosterCollection(
    churchId: string,
    ministryId: string,
    userId: string,
    dto: UpdateRosterCollectionDto,
  ): Promise<{ updated: number }> {
    const ministry = await this.getMinistryOrThrow(churchId, ministryId);
    this.assertMinistryActive(ministry);

    const allowed = await this.churchPermissions.canManageMinistryRosters(
      userId,
      churchId,
      ministryId,
    );

    if (!allowed) {
      throw new ForbiddenException(
        'Sem permissão para gerenciar escalas deste ministério.',
      );
    }

    const hasEventIds = Boolean(dto.eventIds?.length);
    const hasSeries = Boolean(dto.recurrenceSeriesId);

    if (!hasEventIds && !hasSeries) {
      throw new BadRequestException(
        'Informe os eventos ou uma série recorrente.',
      );
    }

    const now = new Date();

    const result = await this.prisma.ministryEvent.updateMany({
      where: {
        churchId,
        ministryId,
        deletedAt: null,
        usesRoster: true,
        startsAt: { gte: now },
        ...(hasEventIds ? { id: { in: dto.eventIds } } : {}),
        ...(hasSeries ? { recurrenceSeriesId: dto.recurrenceSeriesId } : {}),
      },
      data: { rosterOpen: dto.rosterOpen },
    });

    return { updated: result.count };
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
    userId: string,
    dto: CreateMinistryRoleDto,
  ): Promise<MinistryRoleResponse> {
    await this.assertCanManageRoles(userId, churchId, ministryId);
    await this.getMinistryOrThrow(churchId, ministryId);
    await this.ensureRoleNameAvailable(ministryId, dto.name);

    const role = await this.prisma.ministryRole.create({
      data: {
        ministryId,
        name: dto.name.trim(),
        sortOrder: dto.sortOrder ?? 0,
        canManageEvents: dto.canManageEvents ?? false,
        canManageRoster: dto.canManageRoster ?? false,
        canManageTeam: dto.canManageTeam ?? false,
        canManageRoles: dto.canManageRoles ?? false,
        singleHolder: dto.singleHolder ?? false,
      },
    });

    return toMinistryRoleResponse(role);
  }

  async updateRole(
    churchId: string,
    ministryId: string,
    roleId: string,
    userId: string,
    dto: UpdateMinistryRoleDto,
  ): Promise<MinistryRoleResponse> {
    await this.assertCanManageRoles(userId, churchId, ministryId);
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
        ...(dto.canManageTeam !== undefined
          ? { canManageTeam: dto.canManageTeam }
          : {}),
        ...(dto.canManageRoles !== undefined
          ? { canManageRoles: dto.canManageRoles }
          : {}),
        ...(dto.singleHolder !== undefined
          ? { singleHolder: dto.singleHolder }
          : {}),
      },
    });

    return toMinistryRoleResponse(role);
  }

  async removeRole(
    churchId: string,
    ministryId: string,
    roleId: string,
    userId: string,
  ): Promise<void> {
    await this.assertCanManageRoles(userId, churchId, ministryId);
    await this.getMinistryOrThrow(churchId, ministryId);
    await this.getRoleOrThrow(ministryId, roleId);

    await this.prisma.ministryRole.delete({ where: { id: roleId } });
  }

  async listServiceFunctions(
    churchId: string,
    ministryId: string,
  ) {
    await this.getMinistryOrThrow(churchId, ministryId);
    return listMinistryServiceFunctions(this.prisma, ministryId);
  }

  async replaceServiceFunctions(
    churchId: string,
    ministryId: string,
    userId: string,
    dto: ReplaceMinistryServiceFunctionsDto,
  ) {
    await this.getMinistryOrThrow(churchId, ministryId);

    const allowed = await this.churchPermissions.canManageMinistryRosters(
      userId,
      churchId,
      ministryId,
    );

    if (!allowed) {
      throw new ForbiddenException(
        'Sem permissão para gerenciar funções deste ministério.',
      );
    }

    return replaceMinistryServiceFunctions(
      this.prisma,
      ministryId,
      dto.labels,
    );
  }

  async updateMemberInstruments(
    churchId: string,
    ministryId: string,
    memberId: string,
    userId: string,
    dto: UpdateMemberMinistryInstrumentsDto,
  ): Promise<MinistryMemberResponse> {
    await this.getMinistryOrThrow(churchId, ministryId);

    const viewerMember = await this.prisma.member.findFirst({
      where: {
        churchId,
        userId,
        deletedAt: null,
        status: MemberStatus.active,
      },
      select: { id: true },
    });

    const isSelf = viewerMember?.id === memberId;
    const canManage =
      !isSelf &&
      (await this.churchPermissions.canManageMinistryRosters(
        userId,
        churchId,
        ministryId,
      ));

    if (!isSelf && !canManage) {
      throw new ForbiddenException(
        'Sem permissão para alterar as funções deste membro.',
      );
    }

    const link = await this.prisma.memberMinistry.findFirst({
      where: {
        ministryId,
        memberId,
        endedAt: null,
        member: { churchId, deletedAt: null },
      },
      include: {
        member: true,
        roleAssignments: { include: { ministryRole: true } },
      },
    });

    if (!link) {
      throw new NotFoundException('Membro não encontrado neste ministério.');
    }

    const catalog = await listMinistryServiceFunctions(this.prisma, ministryId);
    const instruments = ensureMemberMinistryInstruments(
      dto.instruments,
      catalog.map((item) => item.label),
    );

    const updated = await this.prisma.memberMinistry.update({
      where: { id: link.id },
      data: { instruments },
      include: {
        member: true,
        roleAssignments: { include: { ministryRole: true } },
      },
    });

    return this.mapMinistryMemberLink(updated);
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

    return links.map((link) => this.mapMinistryMemberLink(link));
  }

  private mapMinistryMemberLink(
    link: {
      id: string;
      memberId: string;
      instruments: string[];
      startedAt: Date | null;
      member: {
        name: string;
        email: string | null;
        phone: string | null;
      };
      roleAssignments: Array<{
        ministryRole: {
          id: string;
          name: string;
          canManageEvents: boolean;
          sortOrder: number;
        };
      }>;
    },
  ): MinistryMemberResponse {
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
  }

  async getMySchedules(
    churchId: string,
    userId: string,
  ): Promise<MySchedulesResponse> {
    const empty: MySchedulesResponse = {
      hasSchedule: false,
      churchWide: null,
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
        status: MemberStatus.active,
      },
    });

    if (!member) {
      return empty;
    }

    const now = new Date();

    const churchWideEvents = await this.prisma.ministryEvent.findMany({
      where: {
        churchId,
        ministryId: null,
        deletedAt: null,
        usesRoster: true,
        startsAt: { gte: now },
      },
      include: {
        availabilities: true,
        rosterSlots: { orderBy: { sortOrder: 'asc' } },
        rosterAssignments: {
          include: {
            member: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { startsAt: 'asc' },
      take: 90,
    });

    const churchWideScheduleEvents = churchWideEvents
      .map((event) => this.mapChurchWideScheduleEvent(event, member.id))
      .filter((event): event is MyScheduleEventResponse => event !== null);

    const rosterLinks = await this.prisma.memberMinistry.findMany({
      where: {
        memberId: member.id,
        endedAt: null,
        ministry: {
          churchId,
          isActive: true,
        },
      },
      include: {
        ministry: {
          include: {
            serviceFunctions: { select: { id: true } },
          },
        },
      },
    });

    const ministryIds = rosterLinks.map((link) => link.ministryId);

    const futureMinistryEvents =
      ministryIds.length > 0
        ? await this.prisma.ministryEvent.findMany({
            where: {
              churchId,
              ministryId: { in: ministryIds },
              deletedAt: null,
              usesRoster: true,
              startsAt: { gte: now },
            },
            include: {
              ministry: true,
              availabilities: true,
              rosterSlots: { orderBy: { sortOrder: 'asc' } },
              rosterAssignments: {
                include: {
                  member: { select: { id: true, name: true } },
                },
              },
            },
            orderBy: { startsAt: 'asc' },
            take: 90,
          })
        : [];

    const eventRoleProfiles = await this.prisma.memberEventRoleProfile.findMany({
      where: {
        memberId: member.id,
        ministryId: { in: ministryIds },
      },
    });

    const profileLabelsByKey = new Map(
      eventRoleProfiles.map((profile) => [
        `${profile.ministryId}:${profile.profileKey}`,
        profile.roleLabels,
      ]),
    );

    const scheduleEvents: MyScheduleEventResponse[] = [];

    for (const event of futureMinistryEvents) {
      if (!event.ministryId || !event.ministry) {
        continue;
      }

      const mapped = this.mapMyScheduleEvent(
        {
          ...event,
          ministry: event.ministry,
        },
        member.id,
        profileLabelsByKey,
      );

      if (mapped) {
        scheduleEvents.push(mapped);
      }
    }

    const allScheduleEvents = [...churchWideScheduleEvents, ...scheduleEvents];

    const pendingAvailability = allScheduleEvents
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

    const upcomingAssignments = allScheduleEvents
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
        const ministryEvents = scheduleEvents.filter(
          (event) => event.ministryId === link.ministryId,
        );

        return {
          ministryId: link.ministry.id,
          ministryName: link.ministry.name,
          events: ministryEvents,
          pendingAvailability: pendingAvailability.filter(
            (item) => item.ministryId === link.ministryId,
          ),
          upcomingAssignments: upcomingAssignments.filter(
            (item) => item.ministryId === link.ministryId,
          ),
          rosterFunctions: link.instruments,
          needsRosterFunctions: memberNeedsServiceFunctions(
            link.instruments,
            link.ministry.serviceFunctions,
          ),
        };
      }),
    );

    const churchWidePending = pendingAvailability.filter(
      (item) => item.ministryId === CHURCH_WIDE_SCHEDULE_ID,
    );
    const churchWideAssignments = upcomingAssignments.filter(
      (item) => item.ministryId === CHURCH_WIDE_SCHEDULE_ID,
    );

    const churchWide =
      churchWideScheduleEvents.length > 0
        ? {
            ministryId: CHURCH_WIDE_SCHEDULE_ID,
            ministryName: 'Igreja',
            events: churchWideScheduleEvents,
            pendingAvailability: churchWidePending,
            upcomingAssignments: churchWideAssignments,
            rosterFunctions: [],
            needsRosterFunctions: false,
          }
        : null;

    const missingRosterFunctionsCount = ministries.filter(
      (ministry) => ministry.needsRosterFunctions,
    ).length;

    const hasSchedule = ministries.length > 0 || churchWide !== null;

    return {
      hasSchedule,
      churchWide,
      summary: {
        pendingAvailabilityCount: pendingAvailability.length,
        upcomingAssignmentsCount: upcomingAssignments.length,
        missingRosterFunctionsCount,
        nextAssignment: upcomingAssignments[0] ?? null,
      },
      ministries,
    };
  }

  private mapChurchWideScheduleEvent(
    event: {
      id: string;
      name: string;
      startsAt: Date;
      endsAt: Date | null;
      location: string | null;
      usesRoster: boolean;
      rosterOpen: boolean;
      availabilityMessage: string | null;
      recurrenceSeriesId: string | null;
      availabilities: Array<{
        memberId: string;
        status: 'available' | 'unavailable';
        roleLabels: string[];
      }>;
      rosterSlots: Array<{ label: string }>;
      rosterAssignments: Array<{
        memberId: string;
        roleLabel: string;
        member: { id: string; name: string };
      }>;
    },
    memberId: string,
  ): MyScheduleEventResponse | null {
    const myAssignment = event.rosterAssignments.find(
      (assignment) => assignment.memberId === memberId,
    );
    const myAvailability = event.availabilities.find(
      (availability) => availability.memberId === memberId,
    );

    if (!event.usesRoster && !myAssignment) {
      return null;
    }

    const rosterOpen = event.usesRoster && event.rosterOpen;
    const profileKey = resolveEventProfileKey(
      event.recurrenceSeriesId,
      event.id,
    );

    if (!myAssignment && !myAvailability && !rosterOpen) {
      return null;
    }

    return {
      eventId: event.id,
      ministryId: CHURCH_WIDE_SCHEDULE_ID,
      ministryName: 'Igreja',
      name: event.name,
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt?.toISOString() ?? null,
      location: event.location,
      rosterOpen,
      rosterRoles: event.rosterSlots.map((slot) => slot.label),
      availabilityMessage: event.availabilityMessage,
      profileKey,
      myProfileRoleLabels: myAvailability?.roleLabels ?? [],
      myAvailabilityStatus: myAvailability?.status ?? null,
      myRoleLabels: myAvailability?.roleLabels ?? [],
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

  private mapMyScheduleEvent(
    event: {
      id: string;
      ministryId: string | null;
      name: string;
      startsAt: Date;
      endsAt: Date | null;
      location: string | null;
      usesRoster: boolean;
      rosterOpen: boolean;
      availabilityMessage: string | null;
      recurrenceSeriesId: string | null;
      ministry: {
        id: string;
        name: string;
      };
      availabilities: Array<{
        memberId: string;
        status: 'available' | 'unavailable';
        roleLabels: string[];
      }>;
      rosterSlots: Array<{ label: string }>;
      rosterAssignments: Array<{
        memberId: string;
        roleLabel: string;
        member: { id: string; name: string };
      }>;
    },
    memberId: string,
    profileLabelsByKey: Map<string, string[]>,
  ): MyScheduleEventResponse | null {
    const myAssignment = event.rosterAssignments.find(
      (assignment) => assignment.memberId === memberId,
    );
    const myAvailability = event.availabilities.find(
      (availability) => availability.memberId === memberId,
    );

    if (!event.usesRoster && !myAssignment) {
      return null;
    }

    const rosterOpen = event.usesRoster && event.rosterOpen;
    const profileKey = resolveEventProfileKey(
      event.recurrenceSeriesId,
      event.id,
    );
    const myProfileRoleLabels =
      profileLabelsByKey.get(`${event.ministryId}:${profileKey}`) ?? [];

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
      rosterRoles: event.rosterSlots.map((slot) => slot.label),
      availabilityMessage: event.availabilityMessage,
      profileKey,
      myProfileRoleLabels,
      myAvailabilityStatus: myAvailability?.status ?? null,
      myRoleLabels: myAvailability?.roleLabels ?? [],
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
    const ministry = await this.getMinistryOrThrow(churchId, ministryId);
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

    const now = new Date();

    const events = await this.prisma.ministryEvent.findMany({
      where: {
        churchId,
        ministryId,
        deletedAt: null,
        usesRoster: true,
        startsAt: { gte: now },
      },
      include: {
        availabilities: true,
        rosterSlots: { orderBy: { sortOrder: 'asc' } },
      },
      orderBy: { startsAt: 'asc' },
      take: 60,
    });

    const eventRoleProfiles = await this.prisma.memberEventRoleProfile.findMany({
      where: {
        memberId: memberLink.memberId,
        ministryId,
      },
    });

    const profileLabelsByKey = new Map(
      eventRoleProfiles.map((profile) => [
        profile.profileKey,
        profile.roleLabels,
      ]),
    );

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

      return {
        id: event.id,
        name: event.name,
        startsAt: event.startsAt.toISOString(),
        endsAt: event.endsAt?.toISOString() ?? null,
        location: event.location,
        recurrenceSeriesId: event.recurrenceSeriesId,
        isRecurring: Boolean(event.recurrenceSeriesId),
        rosterOpen: event.rosterOpen,
        rosterRoles: event.rosterSlots.map((slot) => slot.label),
        availabilityMessage: event.availabilityMessage,
        myStatus: myAvailability?.status ?? null,
        myRoleLabels: myAvailability?.roleLabels ?? [],
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

    const series = [...seriesMap.values()]
      .map((group) => {
        const openOccurrences = group.occurrences.filter(
          (item) => item.rosterOpen,
        );

        return {
          key: group.key,
          name: group.name,
          isRecurring: group.isRecurring,
          rosterRoles: [
            ...new Set(
              openOccurrences.flatMap((item) => item.rosterRoles),
            ),
          ],
          myProfileRoleLabels: profileLabelsByKey.get(group.key) ?? [],
          openCount: openOccurrences.length,
          myAvailableCount: openOccurrences.filter(
            (item) => item.myStatus === 'available',
          ).length,
          myUnavailableCount: openOccurrences.filter(
            (item) => item.myStatus === 'unavailable',
          ).length,
          myPendingCount: openOccurrences.filter((item) => item.myStatus === null)
            .length,
          occurrences: openOccurrences,
        };
      })
      .filter((group) => group.occurrences.length > 0);

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
      memberId: memberLink.memberId,
      instruments: memberLink.instruments,
      needsRosterFunctions: needsRosterFunctions(memberLink.instruments),
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
    await this.getMinistryOrThrow(churchId, ministryId);
    const memberLink = await this.getActiveMinistryMemberLink(
      churchId,
      ministryId,
      userId,
    );

    await this.prisma.memberMinistry.update({
      where: { id: memberLink.id },
      data: {
        instruments: ensureMemberMinistryInstruments(
          dto.instruments,
          (
            await listMinistryServiceFunctions(this.prisma, ministryId)
          ).map((item) => item.label),
        ),
      },
    });

    return this.getRosterProfile(churchId, ministryId, userId);
  }

  async updateMyEventRoleProfile(
    churchId: string,
    ministryId: string,
    profileKey: string,
    userId: string,
    dto: UpdateEventRoleProfileDto,
  ): Promise<RosterProfileResponse> {
    await this.getMinistryOrThrow(churchId, ministryId);
    const memberLink = await this.getActiveMinistryMemberLink(
      churchId,
      ministryId,
      userId,
    );

    const allowedSlots = await this.getAllowedProfileRoleLabels(
      churchId,
      ministryId,
      profileKey,
    );

    if (allowedSlots.length === 0) {
      throw new BadRequestException(
        'O líder ainda não definiu as funções deste evento.',
      );
    }

    const roleLabels = filterRoleLabelsForEventSlots(
      allowedSlots,
      dto.roleLabels,
    );

    await this.upsertMemberEventRoleProfile(
      memberLink.memberId,
      ministryId,
      profileKey,
      roleLabels,
    );

    return this.getRosterProfile(churchId, ministryId, userId);
  }

  async updateMyEventAvailability(
    churchId: string,
    ministryId: string,
    eventId: string,
    userId: string,
    dto: UpdateEventAvailabilityDto,
  ): Promise<void> {
    // Parallel lookups — remote DB RTT compounds badly when sequential.
    const [ministry, memberLink, event] = await Promise.all([
      this.getMinistryOrThrow(churchId, ministryId),
      this.getActiveMinistryMemberLink(churchId, ministryId, userId),
      this.prisma.ministryEvent.findFirst({
        where: {
          id: eventId,
          churchId,
          ministryId,
          deletedAt: null,
        },
        select: {
          id: true,
          usesRoster: true,
          rosterOpen: true,
          startsAt: true,
        },
      }),
    ]);

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
          memberId: memberLink.memberId,
        },
      });
      return;
    }

    if (
      memberNeedsServiceFunctions(
        memberLink.instruments,
        ministry.serviceFunctions,
      )
    ) {
      throw new BadRequestException(
        'Configure suas funções no perfil antes de marcar disponibilidade.',
      );
    }

    // available | unavailable — same upsert shape.
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
        roleLabels: [],
      },
      update: {
        status: dto.status,
        roleLabels: [],
      },
    });
  }

  private async resolveAvailabilityRoleLabels(
    memberId: string,
    ministryId: string,
    profileKey: string,
    slotLabels: string[],
    requestedRoleLabels?: string[],
  ): Promise<string[]> {
    let sourceLabels = requestedRoleLabels ?? [];

    if (sourceLabels.length === 0) {
      const profile = await this.prisma.memberEventRoleProfile.findUnique({
        where: {
          memberId_ministryId_profileKey: {
            memberId,
            ministryId,
            profileKey,
          },
        },
      });

      sourceLabels = profile?.roleLabels ?? [];
    }

    const roleLabels = filterRoleLabelsForEventSlots(slotLabels, sourceLabels);

    return roleLabels;
  }

  private async upsertMemberEventRoleProfile(
    memberId: string,
    ministryId: string,
    profileKey: string,
    roleLabels: string[],
  ): Promise<void> {
    const normalized = [
      ...new Set(
        roleLabels.map((item) => item.trim()).filter(Boolean),
      ),
    ];

    if (normalized.length === 0) {
      await this.prisma.memberEventRoleProfile.deleteMany({
        where: {
          memberId,
          ministryId,
          profileKey,
        },
      });
      return;
    }

    await this.prisma.memberEventRoleProfile.upsert({
      where: {
        memberId_ministryId_profileKey: {
          memberId,
          ministryId,
          profileKey,
        },
      },
      create: {
        memberId,
        ministryId,
        profileKey,
        roleLabels: normalized,
      },
      update: {
        roleLabels: normalized,
      },
    });
  }

  private async getAllowedProfileRoleLabels(
    churchId: string,
    ministryId: string,
    profileKey: string,
  ): Promise<string[]> {
    const isSingle = profileKey.startsWith('single:');
    const events = await this.prisma.ministryEvent.findMany({
      where: {
        churchId,
        ministryId,
        deletedAt: null,
        usesRoster: true,
        ...(isSingle
          ? { id: profileKey.slice('single:'.length) }
          : { recurrenceSeriesId: profileKey }),
      },
      include: {
        rosterSlots: { orderBy: { sortOrder: 'asc' } },
      },
    });

    return [
      ...new Set(events.flatMap((item) => item.rosterSlots.map((slot) => slot.label))),
    ];
  }

  private async getActiveMinistryMemberLink(
    churchId: string,
    ministryId: string,
    userId: string,
  ) {
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
      const member = await this.prisma.member.findFirst({
        where: {
          churchId,
          userId,
          deletedAt: null,
        },
        select: { id: true },
      });

      if (!member) {
        throw new ForbiddenException(
          'Seu usuário não está vinculado a um cadastro pastoral nesta igreja.',
        );
      }

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
    this.assertMinistryActive(ministry);
    await this.assertCanManageEvents(userId, churchId, ministryId);

    const visibleToChurch = await this.resolveVisibleToChurch(
      userId,
      churchId,
      dto.visibleToChurch,
    );

    const usesRoster = dto.usesRoster ?? true;
    const rosterOpen = usesRoster ? (dto.rosterOpen ?? false) : false;

    const { event, occurrencesCreated } = await this.eventCreation.createEvent({
      churchId,
      ministryId,
      name: dto.name,
      description: dto.description,
      highlightNote: dto.highlightNote,
      availabilityMessage: dto.availabilityMessage,
      location: dto.location,
      startsAt: new Date(dto.startsAt),
      endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
      createdByUserId: userId,
      recurrence: dto.recurrence,
      usesRoster,
      rosterOpen,
      rosterRoles: dto.rosterRoles,
      rosterSlotPlan: resolveRosterSlotPlan({
        rosterSlotPlan: dto.rosterSlotPlan,
        rosterRoles: dto.rosterRoles,
      }),
      visibleToChurch,
    });

    const eventWithSlots = await this.prisma.ministryEvent.findFirstOrThrow({
      where: { id: event.id, churchId },
      include: {
        ministry: true,
        recurrenceSeries: true,
        rosterSlots: {
          orderBy: { sortOrder: 'asc' },
          include: {
            assignments: {
              include: { member: true },
            },
          },
        },
      },
    });

    return {
      ...toMinistryEventResponse(eventWithSlots),
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
    const ministry = await this.getMinistryOrThrow(churchId, ministryId);
    this.assertMinistryActive(ministry);
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
    const ministry = await this.getMinistryOrThrow(churchId, ministryId);
    this.assertMinistryActive(ministry);
    await this.assertCanManageEvents(userId, churchId, ministryId);
    await this.getEventOrThrow(churchId, ministryId, eventId);

    await this.eventsService.remove(churchId, eventId, userId, scope);
  }

  private async resolveVisibleToChurch(
    userId: string,
    churchId: string,
    requested?: boolean,
  ): Promise<boolean> {
    if (!requested) {
      return false;
    }

    const allowed = await this.churchPermissions.hasPermission(
      userId,
      churchId,
      ChurchPermission.events_create_church_wide,
    );

    if (!allowed) {
      throw new ForbiddenException(
        'Sem permissão para exibir eventos na agenda da igreja inteira.',
      );
    }

    return true;
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

  private async assertCanManageRoles(
    userId: string,
    churchId: string,
    ministryId: string,
  ) {
    const allowed = await this.churchPermissions.canManageMinistryRoles(
      userId,
      churchId,
      ministryId,
    );

    if (!allowed) {
      throw new ForbiddenException(
        'Sem permissão para gerenciar cargos deste ministério.',
      );
    }
  }

  private assertMinistryActive(ministry: { isActive: boolean }) {
    if (!ministry.isActive) {
      throw new ForbiddenException(
        'Este ministério está inativo. Reative-o para gerenciar eventos e escalas.',
      );
    }
  }

  private async getMinistryOrThrow(churchId: string, ministryId: string) {
    const ministry = await this.prisma.ministry.findFirst({
      where: { id: ministryId, churchId },
      include: { roles: true, serviceFunctions: true },
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
}
