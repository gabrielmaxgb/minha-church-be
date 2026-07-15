import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CareRequestStatus,
  CareRequestType,
  ChurchPermission,
  MemberStatus,
} from '@prisma/client';

import { ChurchPermissionsService } from '../../common/services/church-permissions.service';
import { EmailService } from '../../common/services/email.service';
import { PrismaService } from '../../database/prisma.service';
import { CreateCareRequestDto } from './dto/care-request.dto';
import {
  CARE_REQUEST_TYPE_LABELS,
  toCareRequestResponse,
  type CareRequestRecipientResponse,
  type CareRequestResponse,
} from './care-requests.types';

const ADULT_AGE = 18;
const memberSelect = { id: true, name: true } as const;

@Injectable()
export class CareRequestsService {
  private readonly logger = new Logger(CareRequestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly churchPermissions: ChurchPermissionsService,
    private readonly emailService: EmailService,
    private readonly config: ConfigService,
  ) {}

  async listRecipients(
    churchId: string,
    userId: string,
  ): Promise<CareRequestRecipientResponse[]> {
    const requester = await this.requireActiveAdultMember(churchId, userId);
    const recipients = await this.findEligibleRecipients(churchId);

    return recipients
      .filter((recipient) => recipient.id !== requester.id)
      .map((recipient) => ({
        id: recipient.id,
        name: recipient.name,
        roles: recipient.roles,
      }));
  }

  async listMine(
    churchId: string,
    userId: string,
  ): Promise<CareRequestResponse[]> {
    const requester = await this.requireActiveAdultMember(churchId, userId);

    const requests = await this.prisma.careRequest.findMany({
      where: {
        churchId,
        requesterMemberId: requester.id,
      },
      include: {
        requester: { select: memberSelect },
        recipient: { select: memberSelect },
      },
      orderBy: { createdAt: 'desc' },
    });

    return requests.map(toCareRequestResponse);
  }

  async listInbox(
    churchId: string,
    userId: string,
  ): Promise<CareRequestResponse[]> {
    await this.requireReceivePermission(churchId, userId);
    const recipient = await this.requireLinkedMember(churchId, userId);

    const requests = await this.prisma.careRequest.findMany({
      where: {
        churchId,
        recipientMemberId: recipient.id,
      },
      include: {
        requester: { select: memberSelect },
        recipient: { select: memberSelect },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });

    return requests.map(toCareRequestResponse);
  }

  async pendingInboxCount(churchId: string, userId: string): Promise<number> {
    const canReceive = await this.churchPermissions.hasPermission(
      userId,
      churchId,
      ChurchPermission.counseling_receive,
    );

    if (!canReceive) {
      return 0;
    }

    const recipient = await this.prisma.member.findFirst({
      where: { churchId, userId, deletedAt: null },
      select: { id: true },
    });

    if (!recipient) {
      return 0;
    }

    return this.prisma.careRequest.count({
      where: {
        churchId,
        recipientMemberId: recipient.id,
        status: CareRequestStatus.pending,
      },
    });
  }

  async viewedMineCount(churchId: string, userId: string): Promise<number> {
    const requester = await this.prisma.member.findFirst({
      where: { churchId, userId, deletedAt: null },
      select: { id: true },
    });

    if (!requester) {
      return 0;
    }

    return this.prisma.careRequest.count({
      where: {
        churchId,
        requesterMemberId: requester.id,
        status: CareRequestStatus.viewed,
        viewNotificationAckedAt: null,
      },
    });
  }

  async ackViewedMine(churchId: string, userId: string): Promise<{ count: number }> {
    const requester = await this.requireLinkedMember(churchId, userId);

    await this.prisma.careRequest.updateMany({
      where: {
        churchId,
        requesterMemberId: requester.id,
        status: CareRequestStatus.viewed,
        viewNotificationAckedAt: null,
      },
      data: {
        viewNotificationAckedAt: new Date(),
      },
    });

    return { count: 0 };
  }

  async create(
    churchId: string,
    userId: string,
    dto: CreateCareRequestDto,
  ): Promise<CareRequestResponse> {
    const requester = await this.requireActiveAdultMember(churchId, userId);

    if (dto.recipientMemberId === requester.id) {
      throw new BadRequestException(
        'Você não pode enviar uma solicitação para si mesmo.',
      );
    }

    const recipients = await this.findEligibleRecipients(churchId);
    const recipient = recipients.find(
      (item) => item.id === dto.recipientMemberId,
    );

    if (!recipient) {
      throw new BadRequestException(
        'Esta pessoa não pode receber pedidos de aconselhamento ou visita.',
      );
    }

    const message = dto.message?.trim() ? dto.message.trim() : null;

    const created = await this.prisma.careRequest.create({
      data: {
        churchId,
        type: dto.type,
        requesterMemberId: requester.id,
        recipientMemberId: recipient.id,
        message,
      },
      include: {
        requester: { select: memberSelect },
        recipient: { select: memberSelect },
        church: { select: { name: true } },
      },
    });

    void this.notifyRecipient({
      recipientUserId: recipient.userId,
      recipientEmail: recipient.email,
      recipientName: recipient.name,
      requesterName: requester.name,
      churchName: created.church.name,
      type: created.type,
      message: created.message,
    }).catch((error: unknown) => {
      this.logger.warn(
        `Falha ao notificar destinatário do pedido ${created.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });

    return toCareRequestResponse(created);
  }

  async markViewed(
    churchId: string,
    userId: string,
    requestId: string,
  ): Promise<CareRequestResponse> {
    await this.requireReceivePermission(churchId, userId);
    const recipient = await this.requireLinkedMember(churchId, userId);

    const existing = await this.prisma.careRequest.findFirst({
      where: { id: requestId, churchId },
      include: {
        requester: { select: memberSelect },
        recipient: { select: memberSelect },
      },
    });

    if (!existing) {
      throw new NotFoundException('Solicitação não encontrada.');
    }

    if (existing.recipientMemberId !== recipient.id) {
      throw new ForbiddenException(
        'Somente o destinatário pode marcar a solicitação como visualizada.',
      );
    }

    if (existing.status === CareRequestStatus.viewed) {
      return toCareRequestResponse(existing);
    }

    const updated = await this.prisma.careRequest.update({
      where: { id: existing.id },
      data: {
        status: CareRequestStatus.viewed,
        viewedAt: new Date(),
        viewNotificationAckedAt: null,
      },
      include: {
        requester: { select: memberSelect },
        recipient: { select: memberSelect },
      },
    });

    return toCareRequestResponse(updated);
  }

  private async requireReceivePermission(churchId: string, userId: string) {
    const allowed = await this.churchPermissions.hasPermission(
      userId,
      churchId,
      ChurchPermission.counseling_receive,
    );

    if (!allowed) {
      throw new ForbiddenException(
        'Permissão insuficiente para receber pedidos de aconselhamento e visitas.',
      );
    }
  }

  private async requireLinkedMember(churchId: string, userId: string) {
    const member = await this.prisma.member.findFirst({
      where: { churchId, userId, deletedAt: null },
    });

    if (!member) {
      throw new ForbiddenException(
        'É necessário ter um cadastro pastoral vinculado para usar esta área.',
      );
    }

    return member;
  }

  private async requireActiveAdultMember(churchId: string, userId: string) {
    const member = await this.requireLinkedMember(churchId, userId);

    const access = await this.churchPermissions.getMembershipAccess(
      userId,
      churchId,
    );

    // Owner always may use this area (still needs a linked pastoral profile).
    if (access?.isOwner) {
      return member;
    }

    if (member.status !== MemberStatus.active) {
      throw new ForbiddenException(
        'Somente membros ativos podem enviar pedidos de aconselhamento e visitas.',
      );
    }

    if (!member.birthDate) {
      throw new ForbiddenException(
        'Complete a data de nascimento na sua ficha pastoral para usar esta área.',
      );
    }

    if (!this.isAtLeastAge(member.birthDate, ADULT_AGE)) {
      throw new ForbiddenException(
        'É necessário ter 18 anos ou mais para enviar pedidos de aconselhamento e visitas.',
      );
    }

    return member;
  }

  private isAtLeastAge(birthDate: Date, age: number): boolean {
    const today = new Date();
    const threshold = new Date(
      today.getFullYear() - age,
      today.getMonth(),
      today.getDate(),
    );

    return birthDate <= threshold;
  }

  private async findEligibleRecipients(churchId: string) {
    const members = await this.prisma.member.findMany({
      where: {
        churchId,
        deletedAt: null,
        userId: { not: null },
        status: MemberStatus.active,
      },
      select: {
        id: true,
        name: true,
        email: true,
        userId: true,
        user: {
          select: {
            email: true,
            memberships: {
              where: { churchId },
              select: {
                isOwner: true,
                roleAssignments: {
                  select: {
                    role: {
                      select: {
                        name: true,
                        permissions: {
                          where: {
                            permission: ChurchPermission.counseling_receive,
                          },
                          select: { permission: true },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return members
      .map((member) => {
        const membership = member.user?.memberships[0];
        if (!membership || !member.userId) {
          return null;
        }

        const canReceive =
          membership.isOwner ||
          membership.roleAssignments.some(
            (assignment) => assignment.role.permissions.length > 0,
          );

        if (!canReceive) {
          return null;
        }

        const roles = membership.isOwner
          ? ['Proprietário']
          : [
              ...new Set(
                membership.roleAssignments
                  .filter((assignment) => assignment.role.permissions.length > 0)
                  .map((assignment) => assignment.role.name),
              ),
            ];

        return {
          id: member.id,
          name: member.name,
          userId: member.userId,
          email: member.email ?? member.user?.email ?? null,
          roles,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }

  private async notifyRecipient(input: {
    recipientUserId: string;
    recipientEmail: string | null;
    recipientName: string;
    requesterName: string;
    churchName: string;
    type: CareRequestType;
    message: string | null;
  }) {
    if (!input.recipientEmail) {
      this.logger.warn(
        `Destinatário ${input.recipientUserId} sem e-mail — notificação por e-mail omitida.`,
      );
      return;
    }

    const appUrl = this.config.getOrThrow<string>('appUrl').replace(/\/$/, '');
    const inboxUrl = `${appUrl}/app/aconselhamentos`;

    await this.emailService.sendCareRequestEmail(input.recipientEmail, {
      recipientName: input.recipientName,
      requesterName: input.requesterName,
      churchName: input.churchName,
      requestTypeLabel: CARE_REQUEST_TYPE_LABELS[input.type],
      message: input.message,
      inboxUrl,
      appUrl,
    });
  }

}
