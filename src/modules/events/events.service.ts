import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ChurchPermission,
  EventTicketStatus,
  MemberStatus,
  Prisma,
  type MinistryEvent,
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
import { NotificationsService } from '../notifications/notifications.service';
import { GIVING_MIN_AMOUNT_CENTS } from '../payments/dto/create-giving-checkout.dto';
import { PaymentsService } from '../payments/payments.service';
import { EventCreationService } from './event-creation.service';
import { resolveEventRegistrationFields } from './event-registration-fields';
import { syncEventRosterSlots, RosterSlotSyncError, resolveRosterSlotPlan, syncRosterCollectionState, wasRosterFullyStaffed } from './event-roster-slots';
import {
  buildRosterCandidatesFromPool,
} from './roster-candidates';
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
  private readonly logger = new Logger(EventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly churchPermissions: ChurchPermissionsService,
    private readonly eventCreation: EventCreationService,
    private readonly notificationsService: NotificationsService,
    private readonly paymentsService: PaymentsService,
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
      /** Status da inscrição do membro logado, se houver. */
      myTicketStatus: EventTicketStatus | null;
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

    const roster =
      usesRoster || canManageRoster
        ? await this.buildRosterResponse(event, event.ministryId)
        : [];
    // Líder sempre vê o time completo (disponibilidade = sinal). A atribuição
    // liga usesRoster se ainda estiver false.
    const rosterCandidates = canManageRoster
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
    let myTicketStatus: EventTicketStatus | null = null;

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

      if (event.registrationOpen) {
        const tickets = await this.prisma.eventTicketPurchase.findMany({
          where: {
            eventId,
            memberId: viewerMember.id,
            status: {
              in: [EventTicketStatus.succeeded, EventTicketStatus.pending],
            },
          },
          select: { status: true },
          orderBy: { createdAt: 'desc' },
          take: 5,
        });
        myTicketStatus =
          tickets.find((t) => t.status === EventTicketStatus.succeeded)
            ?.status ??
          tickets[0]?.status ??
          null;
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
      myTicketStatus,
    };
  }

  async listTicketRegistrations(
    churchId: string,
    eventId: string,
    userId: string,
  ): Promise<{
    confirmedCount: number;
    pendingCount: number;
    confirmedAmountCents: number;
    registrations: Array<{
      id: string;
      memberId: string | null;
      name: string;
      email: string | null;
      amountCents: number;
      status: EventTicketStatus;
      createdAt: string;
      updatedAt: string;
    }>;
  }> {
    const event = await this.getEventOrThrow(churchId, eventId);
    await this.assertCanManageEvent(userId, churchId, event);

    if (!event.registrationOpen) {
      return {
        confirmedCount: 0,
        pendingCount: 0,
        confirmedAmountCents: 0,
        registrations: [],
      };
    }

    const tickets = await this.prisma.eventTicketPurchase.findMany({
      where: {
        churchId,
        eventId,
        status: {
          in: [EventTicketStatus.succeeded, EventTicketStatus.pending],
        },
      },
      include: {
        member: {
          select: {
            id: true,
            name: true,
            email: true,
            user: { select: { email: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const sorted = tickets
      .map((ticket) => {
        const email =
          ticket.buyerEmail ??
          ticket.member?.email ??
          ticket.member?.user?.email ??
          null;
        const name =
          ticket.buyerName?.trim() ||
          ticket.member?.name?.trim() ||
          'Participante';

        return {
          id: ticket.id,
          memberId: ticket.memberId,
          name,
          email,
          amountCents: ticket.amountCents,
          status: ticket.status,
          createdAt: ticket.createdAt.toISOString(),
          updatedAt: ticket.updatedAt.toISOString(),
        };
      })
      .sort((a, b) => {
        const rank = (status: EventTicketStatus) =>
          status === EventTicketStatus.succeeded ? 0 : 1;
        const byStatus = rank(a.status) - rank(b.status);
        if (byStatus !== 0) {
          return byStatus;
        }
        return (
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      });

    // Uma linha por pessoa: preferir succeeded; se só pending, o mais recente.
    const registrations: typeof sorted = [];
    const seenKeys = new Set<string>();
    for (const item of sorted) {
      const key =
        item.memberId ??
        (item.email ? `email:${item.email.toLowerCase()}` : `ticket:${item.id}`);
      if (seenKeys.has(key)) {
        continue;
      }
      seenKeys.add(key);
      registrations.push(item);
    }

    const confirmed = registrations.filter(
      (item) => item.status === EventTicketStatus.succeeded,
    );
    const pending = registrations.filter(
      (item) => item.status === EventTicketStatus.pending,
    );

    return {
      confirmedCount: confirmed.length,
      pendingCount: pending.length,
      confirmedAmountCents: confirmed.reduce(
        (sum, item) => sum + item.amountCents,
        0,
      ),
      registrations,
    };
  }

  /**
   * Inscrição gratuita (sem Stripe). Recusa eventos pagos — esses usam ticket-checkout.
   */
  async registerForFreeEvent(
    churchId: string,
    eventId: string,
    userId: string,
  ): Promise<{
    id: string;
    status: EventTicketStatus;
    amountCents: number;
  }> {
    const [event, viewContext] = await Promise.all([
      this.prisma.ministryEvent.findFirst({
        where: { id: eventId, churchId, deletedAt: null },
        select: {
          id: true,
          churchId: true,
          ministryId: true,
          visibleToChurch: true,
          registrationOpen: true,
          priceCents: true,
          ministry: { select: { id: true, isActive: true } },
        },
      }),
      buildEventViewContext(
        this.prisma,
        this.churchPermissions,
        userId,
        churchId,
      ),
    ]);

    if (!event || !canUserViewEventWithContext(event, viewContext)) {
      throw new NotFoundException('Evento não encontrado.');
    }

    if (!event.registrationOpen) {
      throw new BadRequestException(
        'A inscrição neste evento não está aberta.',
      );
    }

    if (
      event.priceCents != null &&
      event.priceCents >= GIVING_MIN_AMOUNT_CENTS
    ) {
      throw new BadRequestException(
        'Este evento exige pagamento da inscrição. Use o checkout.',
      );
    }

    const member = await this.prisma.member.findFirst({
      where: { churchId, userId, deletedAt: null },
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        user: { select: { email: true } },
      },
    });

    if (!member) {
      throw new ForbiddenException(
        'É necessário ter um cadastro pastoral vinculado para se inscrever.',
      );
    }

    if (member.status !== MemberStatus.active) {
      throw new ForbiddenException(
        'Somente membros ativos podem se inscrever neste evento.',
      );
    }

    const buyerEmail =
      (member.email ?? member.user?.email)?.trim().toLowerCase() || null;

    try {
      const ticket = await this.prisma.$transaction(async (tx) => {
        const alreadyRegistered = await tx.eventTicketPurchase.findFirst({
          where: {
            eventId,
            memberId: member.id,
            status: EventTicketStatus.succeeded,
          },
          select: { id: true, amountCents: true, status: true },
        });

        if (alreadyRegistered) {
          throw new ConflictException('Você já está inscrito neste evento.');
        }

        return tx.eventTicketPurchase.create({
          data: {
            churchId,
            eventId,
            memberId: member.id,
            amountCents: 0,
            status: EventTicketStatus.succeeded,
            buyerName: member.name,
            buyerEmail,
            stripePaymentIntentId: null,
          },
          select: {
            id: true,
            status: true,
            amountCents: true,
          },
        });
      });

      return ticket;
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof BadRequestException ||
        error instanceof ForbiddenException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }

      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Você já está inscrito neste evento.');
      }

      throw error;
    }
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

    const roleLabel = normalizeRosterRoleValue(dto.roleLabel);

    if (!roleLabel) {
      throw new BadRequestException('Informe a função da escala.');
    }

    const existingAssignment = await this.prisma.eventRosterAssignment.findUnique({
      where: {
        eventId_memberId: {
          eventId,
          memberId: dto.memberId,
        },
      },
      select: { id: true },
    });
    const isNewAssignment = !existingAssignment;

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

    if (isNewAssignment) {
      const assigned = eventWithRoster.rosterAssignments.find(
        (item) => item.memberId === dto.memberId,
      );
      if (assigned) {
        this.notificationsService.schedule(
          this.notificationsService.emitRosterAssigned({
            churchId,
            eventId,
            eventName: event.name,
            startsAt: event.startsAt,
            memberId: dto.memberId,
            roleLabel: assigned.roleLabel,
            ministryId: event.ministryId,
          }),
          'schedule_roster_assigned',
        );
      }
    }

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

    await this.prisma.notification.deleteMany({
      where: {
        churchId,
        type: 'schedule_roster_assigned',
        entityId: `${eventId}:${memberId}`,
      },
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

    const visibleToChurch = await this.resolveVisibleToChurch({
      userId,
      churchId,
      ministryId: dto.ministryId ?? null,
      requested: dto.visibleToChurch,
    });

    const { registrationOpen, priceCents } = resolveEventRegistrationFields({
      registrationOpen: dto.registrationOpen,
      priceCents: dto.priceCents,
    });
    await this.assertCanChargePaidRegistration(churchId, priceCents);

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
      visibleToChurch,
      registrationOpen,
      priceCents,
    });

    const eventWithSlots = await this.prisma.ministryEvent.findFirstOrThrow({
      where: { id: event.id, churchId },
      include: {
        ...eventInclude,
        rosterSlots: rosterSlotsInclude,
      },
    });

    if (registrationOpen) {
      this.notificationsService.schedule(
        this.emitRegistrationOpenForSeries(churchId, event.id, event.recurrenceSeriesId),
        'registration_open',
      );
    }

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

    // Com useDefineForClassFields, `recurrence` sempre existe no DTO como
    // propriedade própria (mesmo omitida no JSON → undefined). hasOwnProperty
    // NÃO distingue omissão de envio. Tratar:
    // - undefined → omitido → só atualiza campos (mantém série)
    // - null → remove repetição no escopo
    // - objeto → muda/recria regra
    if (dto.recurrence !== undefined) {
      const recurrenceUpdate = dto.recurrence;
      const scope = this.resolveScope(existing, dto.scope);
      const startsAt =
        dto.startsAt !== undefined
          ? new Date(dto.startsAt)
          : existing.startsAt;
      const endsAt =
        dto.endsAt !== undefined
          ? dto.endsAt
            ? new Date(dto.endsAt)
            : null
          : existing.endsAt;
      const usesRoster =
        dto.usesRoster !== undefined ? dto.usesRoster : existing.usesRoster;
      const rosterOpen = usesRoster
        ? dto.rosterOpen !== undefined
          ? dto.rosterOpen
          : existing.rosterOpen
        : false;
      const visibleToChurch = existing.ministryId
        ? await this.resolveVisibleToChurch({
            userId,
            churchId,
            ministryId: existing.ministryId,
            requested: dto.visibleToChurch,
            existingValue: existing.visibleToChurch,
          })
        : true;

      const { registrationOpen, priceCents } = resolveEventRegistrationFields({
        registrationOpen: dto.registrationOpen,
        priceCents: dto.priceCents,
        existingRegistrationOpen: existing.registrationOpen,
        existingPriceCents: existing.priceCents,
      });
      await this.assertCanChargePaidRegistration(
        churchId,
        priceCents,
        existing.priceCents,
      );

      const rosterPlanUpdateRequested =
        dto.rosterSlotPlan !== undefined || dto.rosterRoles !== undefined;

      let rosterSlotPlan = resolveRosterSlotPlan({
        rosterSlotPlan: dto.rosterSlotPlan,
        rosterRoles: dto.rosterRoles,
      });

      if (!rosterPlanUpdateRequested && usesRoster) {
        const slots = await this.prisma.eventRosterSlot.findMany({
          where: { eventId: existing.id },
          orderBy: { sortOrder: 'asc' },
        });
        rosterSlotPlan = slots.map((slot) => ({
          label: slot.label,
          requiredCount: slot.requiredCount,
        }));
      }

      const recurrenceChanged = await this.hasRecurrenceChange(
        existing,
        recurrenceUpdate,
        startsAt,
      );

      if (recurrenceChanged) {
        await this.eventCreation.applyRecurrenceUpdate({
          churchId,
          event: existing,
          scope,
          recurrence: recurrenceUpdate,
          name: dto.name !== undefined ? dto.name : existing.name,
          description:
            dto.description !== undefined
              ? dto.description
              : existing.description,
          highlightNote:
            dto.highlightNote !== undefined
              ? dto.highlightNote
              : existing.highlightNote,
          availabilityMessage:
            dto.availabilityMessage !== undefined
              ? dto.availabilityMessage
              : existing.availabilityMessage,
          location:
            dto.location !== undefined ? dto.location : existing.location,
          startsAt,
          endsAt,
          usesRoster,
          rosterOpen,
          visibleToChurch,
          registrationOpen,
          priceCents,
          rosterSlotPlan,
        });

        if (rosterPlanUpdateRequested && usesRoster) {
          try {
            await syncEventRosterSlots(this.prisma, eventId, rosterSlotPlan);
          } catch (error) {
            if (error instanceof RosterSlotSyncError) {
              throw new BadRequestException(error.message);
            }
            throw error;
          }
        }

        const event = await this.prisma.ministryEvent.findFirstOrThrow({
          where: { id: eventId, churchId },
          include: {
            ...eventInclude,
            rosterSlots: rosterSlotsInclude,
          },
        });

        if (registrationOpen && !existing.registrationOpen) {
          this.notificationsService.schedule(
            this.emitRegistrationOpenForSeries(
              churchId,
              event.id,
              event.recurrenceSeriesId,
            ),
            'registration_open',
          );
        }

        return toMinistryEventResponse(event);
      }
    }

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

    if (
      dto.registrationOpen !== undefined ||
      dto.priceCents !== undefined
    ) {
      const resolved = resolveEventRegistrationFields({
        registrationOpen: dto.registrationOpen,
        priceCents: dto.priceCents,
        existingRegistrationOpen: existing.registrationOpen,
        existingPriceCents: existing.priceCents,
      });
      await this.assertCanChargePaidRegistration(
        churchId,
        resolved.priceCents,
        existing.priceCents,
      );
    }

    const nextVisibleToChurch =
      dto.visibleToChurch !== undefined && existing.ministryId
        ? await this.resolveVisibleToChurch({
            userId,
            churchId,
            ministryId: existing.ministryId,
            requested: dto.visibleToChurch,
          })
        : undefined;

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

        if (nextVisibleToChurch !== undefined && target.ministryId) {
          data.visibleToChurch = nextVisibleToChurch;
        }

        if (
          dto.registrationOpen !== undefined ||
          dto.priceCents !== undefined
        ) {
          const resolved = resolveEventRegistrationFields({
            registrationOpen: dto.registrationOpen,
            priceCents: dto.priceCents,
            existingRegistrationOpen: target.registrationOpen,
            existingPriceCents: target.priceCents,
          });
          data.registrationOpen = resolved.registrationOpen;
          data.priceCents = resolved.priceCents;
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

    if (event.registrationOpen && !existing.registrationOpen) {
      this.notificationsService.schedule(
        this.emitRegistrationOpenForSeries(
          churchId,
          event.id,
          event.recurrenceSeriesId,
        ),
        'registration_open',
      );
    }

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
    const deletedAt = new Date();

    // updateMany direto no escopo — evita carregar todas as ocorrências da série.
    const where: Prisma.MinistryEventWhereInput = {
      churchId,
      deletedAt: null,
    };

    if (!existing.recurrenceSeriesId || resolvedScope === 'this') {
      where.id = existing.id;
    } else {
      where.recurrenceSeriesId = existing.recurrenceSeriesId;
      if (resolvedScope === 'this_and_following') {
        where.startsAt = { gte: existing.startsAt };
      }
    }

    await this.prisma.ministryEvent.updateMany({
      where,
      data: { deletedAt },
    });
  }

  private async hasRecurrenceChange(
    event: MinistryEvent,
    recurrence: UpdateChurchEventDto['recurrence'],
    startsAt: Date,
  ): Promise<boolean> {
    // Omitido: sem mudança de regra (só campos da ocorrência).
    if (recurrence === undefined) {
      return false;
    }

    // null: remove repetição.
    if (recurrence === null) {
      return Boolean(event.recurrenceSeriesId);
    }

    if (!event.recurrenceSeriesId) {
      return true;
    }

    const series = await this.prisma.eventRecurrenceSeries.findUnique({
      where: { id: event.recurrenceSeriesId },
    });

    if (!series) {
      return true;
    }

    const interval = recurrence.interval ?? 1;
    const daysOfWeek =
      recurrence.frequency === 'weekly'
        ? [...(recurrence.daysOfWeek ?? [startsAt.getDay()])].sort(
            (a, b) => a - b,
          )
        : [];
    const seriesDays = [...series.daysOfWeek].sort((a, b) => a - b);
    const seriesEnd = series.endDate
      ? series.endDate.toISOString().slice(0, 10)
      : null;
    const nextEnd = recurrence.endDate ?? null;

    return (
      series.frequency !== recurrence.frequency ||
      series.interval !== interval ||
      (recurrence.frequency === 'weekly' &&
        seriesDays.join(',') !== daysOfWeek.join(',')) ||
      seriesEnd !== nextEnd ||
      (series.maxOccurrences ?? null) !== (recurrence.maxOccurrences ?? null)
    );
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

  private async emitRegistrationOpenForSeries(
    churchId: string,
    eventId: string,
    recurrenceSeriesId: string | null,
  ): Promise<void> {
    // Uma notificação por série (próxima ocorrência útil), para não poluir o
    // sininho com um item por data recorrente.
    const select = {
      id: true,
      churchId: true,
      name: true,
      startsAt: true,
      ministryId: true,
      visibleToChurch: true,
      registrationOpen: true,
      recurrenceSeriesId: true,
    } as const;

    let event = recurrenceSeriesId
      ? await this.prisma.ministryEvent.findFirst({
          where: {
            churchId,
            recurrenceSeriesId,
            deletedAt: null,
            registrationOpen: true,
            startsAt: { gte: new Date() },
          },
          orderBy: { startsAt: 'asc' },
          select,
        })
      : await this.prisma.ministryEvent.findFirst({
          where: {
            id: eventId,
            churchId,
            deletedAt: null,
            registrationOpen: true,
          },
          select,
        });

    // Série cuja próxima data já passou do filtro "futuro", mas ainda tem
    // ocorrência com inscrição aberta (ex.: evento de hoje que acabou de começar).
    if (!event && recurrenceSeriesId) {
      event = await this.prisma.ministryEvent.findFirst({
        where: {
          churchId,
          recurrenceSeriesId,
          deletedAt: null,
          registrationOpen: true,
        },
        orderBy: { startsAt: 'asc' },
        select,
      });
    }

    if (!event) {
      this.logger.warn(
        `registration_open: nenhuma ocorrência elegível (event=${eventId}, series=${recurrenceSeriesId ?? 'none'}).`,
      );
      return;
    }

    await this.notificationsService.emitRegistrationOpen(event);
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

  private async assertCanChargePaidRegistration(
    churchId: string,
    priceCents: number | null,
    existingPriceCents?: number | null,
  ): Promise<void> {
    if (priceCents == null || priceCents < GIVING_MIN_AMOUNT_CENTS) {
      return;
    }

    const hadPaid =
      existingPriceCents != null &&
      existingPriceCents >= GIVING_MIN_AMOUNT_CENTS;

    if (hadPaid && existingPriceCents === priceCents) {
      return;
    }

    const connect = await this.paymentsService.getConnectStatus(churchId);
    if (!connect.canReceivePayments) {
      throw new BadRequestException(
        'Ative os recebimentos da igreja antes de abrir inscrição paga neste evento.',
      );
    }
  }

  private async resolveVisibleToChurch(params: {
    userId: string;
    churchId: string;
    ministryId: string | null;
    requested?: boolean;
    existingValue?: boolean;
  }): Promise<boolean> {
    if (!params.ministryId) {
      return true;
    }

    if (params.requested === undefined) {
      return params.existingValue ?? false;
    }

    if (!params.requested) {
      return false;
    }

    const allowed = await this.churchPermissions.hasPermission(
      params.userId,
      params.churchId,
      ChurchPermission.events_create_church_wide,
    );

    if (!allowed) {
      throw new ForbiddenException(
        'Sem permissão para exibir eventos na agenda da igreja inteira.',
      );
    }

    return true;
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
    const assignedIds = event.rosterAssignments.map((item) => item.memberId);

    if (event.ministryId) {
      // Uma query só: todo o time do ministério (select enxuto).
      const links = await this.prisma.memberMinistry.findMany({
        where: {
          ministryId: event.ministryId,
          endedAt: null,
          member: {
            churchId,
            deletedAt: null,
            status: MemberStatus.active,
          },
        },
        select: {
          memberId: true,
          instruments: true,
          member: { select: { name: true } },
        },
        orderBy: { member: { name: 'asc' } },
      });

      return buildRosterCandidatesFromPool({
        pool: links.map((link) => ({
          memberId: link.memberId,
          memberName: link.member.name,
          roleLabels: link.instruments ?? [],
        })),
        availabilities: event.availabilities,
        assignedMemberIds: assignedIds,
      });
    }

    // Atividade da igreja: pool = membros ativos (id+nome). Cruzamento em memória.
    const members = await this.prisma.member.findMany({
      where: {
        churchId,
        deletedAt: null,
        status: MemberStatus.active,
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });

    const eventSlotLabels = event.rosterSlots.map((slot) => slot.label);
    const fallbackRoleLabels =
      eventSlotLabels.length > 0
        ? eventSlotLabels
        : [CHURCH_WIDE_DEFAULT_ROSTER_ROLE];

    return buildRosterCandidatesFromPool({
      pool: members.map((member) => ({
        memberId: member.id,
        memberName: member.name,
        roleLabels: [],
      })),
      availabilities: event.availabilities,
      assignedMemberIds: assignedIds,
      fallbackRoleLabels,
    });
  }
}
