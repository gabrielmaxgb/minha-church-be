import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ChurchPermission,
  MemberStatus,
  NotificationType,
  Prisma,
} from '@prisma/client';

import { ChurchPermissionsService } from '../../common/services/church-permissions.service';
import { PrismaService } from '../../database/prisma.service';
import { formatRosterRole } from '../ministries/roster-roles';
import type {
  NotificationInboxItem,
  NotificationInboxResponse,
} from './notifications.types';
import { PushService } from './push.service';

type RegistrationOpenEvent = {
  id: string;
  churchId: string;
  name: string;
  startsAt: Date;
  ministryId: string | null;
  visibleToChurch: boolean;
  registrationOpen: boolean;
  /** Quando preenchido, dedupe fica por série (1 notificação), não por ocorrência. */
  recurrenceSeriesId?: string | null;
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly churchPermissions: ChurchPermissionsService,
    private readonly pushService: PushService,
  ) {}

  async listForUser(
    churchId: string,
    userId: string,
  ): Promise<NotificationInboxResponse> {
    const canManageMemberships = await this.churchPermissions.hasAnyPermission(
      userId,
      churchId,
      [ChurchPermission.memberships_manage],
    );

    const now = new Date();

    const rows = await this.prisma.notification.findMany({
      where: {
        churchId,
        OR: [
          { userId },
          ...(canManageMemberships
            ? [{ userId: null, type: NotificationType.pending_access }]
            : []),
        ],
        AND: [
          {
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
        ],
      },
      include: {
        reads: {
          where: { userId },
          select: { id: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const pendingAccessEntityIds = rows
      .filter((row) => row.type === NotificationType.pending_access && row.entityId)
      .map((row) => row.entityId!);

    const stillPendingUserIds =
      pendingAccessEntityIds.length > 0
        ? new Set(
            (
              await this.prisma.user.findMany({
                where: {
                  id: { in: pendingAccessEntityIds },
                  mustChangePassword: true,
                  temporaryPasswordEnc: { not: null },
                  memberships: { some: { churchId } },
                },
                select: { id: true },
              })
            ).map((user) => user.id),
          )
        : new Set<string>();

    const closedRegistrationEntityIds =
      await this.findClosedRegistrationEntityIds(
        rows
          .filter(
            (row) =>
              row.type === NotificationType.registration_open && row.entityId,
          )
          .map((row) => ({
            entityId: row.entityId!,
            entityType: row.entityType,
          })),
      );

    const items: NotificationInboxItem[] = [];

    for (const row of rows) {
      if (
        row.type === NotificationType.pending_access &&
        row.entityId &&
        !stillPendingUserIds.has(row.entityId)
      ) {
        continue;
      }

      if (
        row.type === NotificationType.registration_open &&
        row.entityId &&
        closedRegistrationEntityIds.has(row.entityId)
      ) {
        continue;
      }

      const isShared = row.userId == null;
      const read = isShared
        ? row.reads.length > 0
        : Boolean(row.readAt ?? row.ackedAt);

      items.push({
        id: row.id,
        type: row.type,
        title: row.title,
        body: formatNotificationBody(row.type, row.body, row.payload),
        href: row.href,
        entityType: row.entityType,
        entityId: row.entityId,
        payload: row.payload,
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt?.toISOString() ?? null,
        read,
      });
    }

    const unreadCount = items.filter((item) => !item.read).length;

    return { items, unreadCount };
  }

  async markRead(
    churchId: string,
    notificationId: string,
    userId: string,
  ): Promise<{ ok: true }> {
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, churchId },
    });

    if (!notification) {
      throw new NotFoundException('Notificação não encontrada.');
    }

    const isShared = notification.userId == null;
    const isOwner = notification.userId === userId;

    if (!isShared && !isOwner) {
      throw new NotFoundException('Notificação não encontrada.');
    }

    if (isShared) {
      if (notification.type === NotificationType.pending_access) {
        const canManage = await this.churchPermissions.hasAnyPermission(
          userId,
          churchId,
          [ChurchPermission.memberships_manage],
        );
        if (!canManage) {
          throw new NotFoundException('Notificação não encontrada.');
        }
      }

      await this.prisma.notificationRead.upsert({
        where: {
          notificationId_userId: {
            notificationId: notification.id,
            userId,
          },
        },
        create: {
          notificationId: notification.id,
          userId,
        },
        update: {
          readAt: new Date(),
        },
      });
    } else {
      await this.prisma.notification.update({
        where: { id: notification.id },
        data: {
          readAt: new Date(),
          ackedAt: new Date(),
        },
      });
    }

    return { ok: true };
  }

  async emitRegistrationOpen(event: RegistrationOpenEvent): Promise<void> {
    if (!event.registrationOpen) {
      return;
    }

    const audienceUserIds = await this.resolveRegistrationAudience(event);
    if (audienceUserIds.length === 0) {
      this.logger.warn(
        `registration_open sem audiência (event=${event.id}, ministry=${event.ministryId ?? 'none'}, visibleToChurch=${event.visibleToChurch}). Só membros ativos com conta de acesso recebem o sino.`,
      );
      return;
    }

    const href = `/app/atividades/${event.id}`;
    const title = event.name;
    const body = 'Inscrições abertas — confirme sua participação';
    // Uma notificação por série (recurrenceSeriesId), não por ocorrência.
    const entityId = event.recurrenceSeriesId ?? event.id;

    for (const userId of audienceUserIds) {
      await this.upsertPersonalNotification({
        churchId: event.churchId,
        type: NotificationType.registration_open,
        userId,
        title,
        body,
        href,
        entityType: event.recurrenceSeriesId
          ? 'EventRecurrenceSeries'
          : 'MinistryEvent',
        entityId,
        // Não expira em startsAt: inscrição pode continuar aberta depois do
        // horário de início. sumiço fica a cargo de findClosedRegistrationEventIds.
        expiresAt: null,
        payload: {
          eventId: event.id,
          recurrenceSeriesId: event.recurrenceSeriesId ?? null,
        },
        resetRead: true,
      });
    }
  }

  async emitRosterAssigned(input: {
    churchId: string;
    eventId: string;
    eventName: string;
    startsAt: Date;
    memberId: string;
    roleLabel: string;
    ministryId?: string | null;
  }): Promise<void> {
    const member = await this.prisma.member.findFirst({
      where: {
        id: input.memberId,
        churchId: input.churchId,
        deletedAt: null,
        userId: { not: null },
      },
      select: { userId: true },
    });

    if (!member?.userId) {
      return;
    }

    const href = input.ministryId
      ? `/app/minhas-escalas/${input.ministryId}`
      : '/app/minhas-escalas';

    const roleLabel = formatRosterRole(input.roleLabel);

    await this.upsertPersonalNotification({
      churchId: input.churchId,
      type: NotificationType.schedule_roster_assigned,
      userId: member.userId,
      title: input.eventName,
      body: `Você está na escala como ${roleLabel}.`,
      href,
      entityType: 'EventRosterAssignment',
      entityId: `${input.eventId}:${input.memberId}`,
      expiresAt: input.startsAt,
      payload: {
        eventId: input.eventId,
        roleLabel: input.roleLabel,
        ministryId: input.ministryId ?? null,
      },
      resetRead: true,
    });
  }

  async emitAccountLinked(input: {
    churchId: string;
    userId: string;
    churchName: string;
  }): Promise<void> {
    await this.upsertPersonalNotification({
      churchId: input.churchId,
      type: NotificationType.account_linked,
      userId: input.userId,
      title: `Você foi adicionado a ${input.churchName}`,
      body: 'Sua conta agora tem acesso a esta igreja.',
      href: '/app/dashboard',
      entityType: 'Church',
      entityId: input.churchId,
      resetRead: true,
    });
  }

  /**
   * Avisa o doador (membro com userId) que a contribuição foi estornada.
   * No-op se a doação for pública/guest (sem donorMemberId / sem conta).
   */
  async emitGivingDonationRefunded(input: {
    churchId: string;
    donationId: string;
    donorMemberId: string | null;
    amountCents: number;
    currency?: string;
    fundName?: string | null;
    resetRead?: boolean;
  }): Promise<void> {
    if (!input.donorMemberId) {
      return;
    }

    const member = await this.prisma.member.findFirst({
      where: {
        id: input.donorMemberId,
        churchId: input.churchId,
        deletedAt: null,
        userId: { not: null },
      },
      select: { userId: true },
    });

    if (!member?.userId) {
      return;
    }

    const amountLabel = new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: (input.currency ?? 'brl').toUpperCase(),
    }).format(input.amountCents / 100);

    const fundSuffix = input.fundName?.trim()
      ? ` (${input.fundName.trim()})`
      : '';

    await this.upsertPersonalNotification({
      churchId: input.churchId,
      type: NotificationType.giving_donation_refunded,
      userId: member.userId,
      title: 'Contribuição estornada',
      body: `O valor de ${amountLabel}${fundSuffix} foi estornado e deve voltar ao seu meio de pagamento.`,
      href: '/app/configuracoes/usuario?section=my-contributions',
      entityType: 'GivingDonation',
      entityId: input.donationId,
      payload: {
        donationId: input.donationId,
        amountCents: input.amountCents,
        fundName: input.fundName ?? null,
      },
      resetRead: input.resetRead ?? true,
    });
  }

  async emitPendingAccess(input: {
    churchId: string;
    pendingUserId: string;
    pendingUserName: string;
  }): Promise<void> {
    const existing = await this.prisma.notification.findFirst({
      where: {
        churchId: input.churchId,
        type: NotificationType.pending_access,
        userId: null,
        entityId: input.pendingUserId,
      },
    });

    const title = 'Pedido de acesso pendente';
    const body = `${input.pendingUserName} ainda precisa receber as credenciais de acesso.`;
    const href = '/app/configuracoes/igreja?section=pending-users';

    if (existing) {
      await this.prisma.notification.update({
        where: { id: existing.id },
        data: {
          title,
          body,
          href,
          entityType: 'User',
        },
      });
      return;
    }

    const created = await this.prisma.notification.create({
      data: {
        churchId: input.churchId,
        type: NotificationType.pending_access,
        userId: null,
        title,
        body,
        href,
        entityType: 'User',
        entityId: input.pendingUserId,
      },
    });

    const staffUserIds = await this.findMembershipManagers(input.churchId);
    this.pushService.scheduleSendToUsers(staffUserIds, {
      title,
      body,
      href,
      tag: created.id,
    });
  }

  /** Fire-and-forget wrapper for producers. */
  schedule(task: Promise<unknown>, context: string): void {
    void task.catch((error: unknown) => {
      this.logger.warn(
        `Falha ao emitir notificação (${context}): ${
          error instanceof Error ? error.message : 'erro desconhecido'
        }`,
      );
    });
  }

  private async upsertPersonalNotification(input: {
    churchId: string;
    type: NotificationType;
    userId: string;
    title: string;
    body: string | null;
    href: string | null;
    entityType: string;
    entityId: string;
    expiresAt?: Date | null;
    payload?: Prisma.InputJsonValue;
    resetRead?: boolean;
  }): Promise<void> {
    const existing = await this.prisma.notification.findFirst({
      where: {
        churchId: input.churchId,
        type: input.type,
        entityId: input.entityId,
        userId: input.userId,
      },
    });

    if (existing) {
      await this.prisma.notification.update({
        where: { id: existing.id },
        data: {
          title: input.title,
          body: input.body,
          href: input.href,
          entityType: input.entityType,
          expiresAt: input.expiresAt ?? null,
          payload: input.payload ?? undefined,
          ...(input.resetRead
            ? { readAt: null, ackedAt: null }
            : {}),
        },
      });

      if (input.resetRead) {
        this.pushService.scheduleSendToUser(input.userId, {
          title: input.title,
          body: input.body,
          href: input.href,
          tag: existing.id,
        });
      }
      return;
    }

    const created = await this.prisma.notification.create({
      data: {
        churchId: input.churchId,
        type: input.type,
        userId: input.userId,
        title: input.title,
        body: input.body,
        href: input.href,
        entityType: input.entityType,
        entityId: input.entityId,
        expiresAt: input.expiresAt ?? null,
        payload: input.payload ?? undefined,
      },
    });

    this.pushService.scheduleSendToUser(input.userId, {
      title: input.title,
      body: input.body,
      href: input.href,
      tag: created.id,
    });
  }

  /** Owners + quem tem memberships_manage (audiência de pending_access). */
  private async findMembershipManagers(churchId: string): Promise<string[]> {
    const memberships = await this.prisma.churchMembership.findMany({
      where: { churchId },
      select: {
        userId: true,
        isOwner: true,
        roleAssignments: {
          select: {
            role: {
              select: {
                permissions: { select: { permission: true } },
              },
            },
          },
        },
      },
    });

    return [
      ...new Set(
        memberships
          .filter(
            (membership) =>
              membership.isOwner ||
              membership.roleAssignments.some((assignment) =>
                assignment.role.permissions.some(
                  (row) => row.permission === ChurchPermission.memberships_manage,
                ),
              ),
          )
          .map((membership) => membership.userId),
      ),
    ];
  }

  private async resolveRegistrationAudience(
    event: RegistrationOpenEvent,
  ): Promise<string[]> {
    if (!event.ministryId || event.visibleToChurch) {
      const members = await this.prisma.member.findMany({
        where: {
          churchId: event.churchId,
          deletedAt: null,
          status: MemberStatus.active,
          userId: { not: null },
        },
        select: { userId: true },
      });
      return [
        ...new Set(
          members
            .map((member) => member.userId)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
    }

    const links = await this.prisma.memberMinistry.findMany({
      where: {
        ministryId: event.ministryId,
        endedAt: null,
        member: {
          churchId: event.churchId,
          deletedAt: null,
          status: MemberStatus.active,
          userId: { not: null },
        },
      },
      select: {
        member: { select: { userId: true } },
      },
    });

    return [
      ...new Set(
        links
          .map((link) => link.member.userId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
  }

  /**
   * Decide quais notificações registration_open devem sumir do inbox.
   * - MinistryEvent: fecha se a ocorrência fechou/apagou.
   * - EventRecurrenceSeries: fecha se nenhuma ocorrência futura da série
   *   está com inscrição aberta.
   * Nunca tratar id de evento avulso como seriesId (bug que escondia tudo).
   */
  private async findClosedRegistrationEntityIds(
    refs: Array<{ entityId: string; entityType: string | null }>,
  ): Promise<Set<string>> {
    if (refs.length === 0) {
      return new Set();
    }

    const seriesIds = [
      ...new Set(
        refs
          .filter((ref) => ref.entityType === 'EventRecurrenceSeries')
          .map((ref) => ref.entityId),
      ),
    ];
    const seriesIdSet = new Set(seriesIds);
    // Tudo que não for série = ocorrência (inclui entityType null legado).
    const eventIds = [
      ...new Set(
        refs
          .filter((ref) => !seriesIdSet.has(ref.entityId))
          .map((ref) => ref.entityId),
      ),
    ];

    const closed = new Set<string>();

    if (eventIds.length > 0) {
      const closedEvents = await this.prisma.ministryEvent.findMany({
        where: {
          id: { in: eventIds },
          OR: [{ registrationOpen: false }, { deletedAt: { not: null } }],
        },
        select: { id: true },
      });
      for (const event of closedEvents) {
        closed.add(event.id);
      }
    }

    if (seriesIds.length > 0) {
      const openInSeries = await this.prisma.ministryEvent.findMany({
        where: {
          recurrenceSeriesId: { in: seriesIds },
          deletedAt: null,
          registrationOpen: true,
          startsAt: { gte: new Date() },
        },
        select: { recurrenceSeriesId: true },
      });
      const stillOpen = new Set(
        openInSeries
          .map((event) => event.recurrenceSeriesId)
          .filter((id): id is string => Boolean(id)),
      );
      for (const seriesId of seriesIds) {
        if (!stillOpen.has(seriesId)) {
          closed.add(seriesId);
        }
      }
    }

    return closed;
  }
}

function formatNotificationBody(
  type: NotificationType,
  body: string | null,
  payload: Prisma.JsonValue,
): string | null {
  if (type !== NotificationType.schedule_roster_assigned) {
    return body;
  }

  const roleLabel =
    payload &&
    typeof payload === 'object' &&
    !Array.isArray(payload) &&
    typeof (payload as { roleLabel?: unknown }).roleLabel === 'string'
      ? formatRosterRole((payload as { roleLabel: string }).roleLabel)
      : '';

  if (roleLabel) {
    return `Você está na escala como ${roleLabel}.`;
  }

  return body;
}
