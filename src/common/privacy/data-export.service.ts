import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { StreamableFile } from '@nestjs/common';
import { Readable } from 'node:stream';

import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class DataExportService {
  constructor(private readonly prisma: PrismaService) {}

  async exportMembersCsv(
    churchId: string,
    options?: { includeDeleted?: boolean },
  ): Promise<StreamableFile> {
    const members = await this.prisma.member.findMany({
      where: {
        churchId,
        ...(options?.includeDeleted ? {} : { deletedAt: null }),
      },
      orderBy: { name: 'asc' },
    });

    const header = [
      'ID',
      'Nome',
      'E-mail',
      'CPF',
      'Telefone',
      'Situação',
      'Nascimento',
      'Cidade',
      'UF',
      'Excluído em',
      'Criado em',
    ];

    const lines = [
      header.join(','),
      ...members.map((m) =>
        [
          m.id,
          csvEscape(m.name),
          csvEscape(m.email ?? ''),
          csvEscape(m.cpf ?? ''),
          csvEscape(m.phone ?? ''),
          formatMemberStatusLabel(m.status),
          formatCsvDate(m.birthDate),
          csvEscape(m.city ?? ''),
          csvEscape(m.state ?? ''),
          formatCsvDateTime(m.deletedAt),
          formatCsvDateTime(m.createdAt),
        ].join(','),
      ),
    ];

    // BOM (\uFEFF) garante acentuação correta ao abrir no Excel.
    const body = `\uFEFF${lines.join('\n')}\n`;
    return new StreamableFile(Readable.from([body]), {
      type: 'text/csv; charset=utf-8',
      disposition: 'attachment; filename="membros.csv"',
    });
  }

  async exportMembersJson(
    churchId: string,
    options?: { includeDeleted?: boolean },
  ) {
    const members = await this.prisma.member.findMany({
      where: {
        churchId,
        ...(options?.includeDeleted ? {} : { deletedAt: null }),
      },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        email: true,
        cpf: true,
        phone: true,
        phoneSecondary: true,
        birthDate: true,
        gender: true,
        maritalStatus: true,
        street: true,
        number: true,
        complement: true,
        neighborhood: true,
        city: true,
        state: true,
        zipCode: true,
        status: true,
        baptismDate: true,
        membershipDate: true,
        visitorSince: true,
        deletedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return {
      exportedAt: new Date().toISOString(),
      members: members.map((member) => ({
        ...member,
        status: formatMemberStatusLabel(member.status),
        gender: formatGenderLabel(member.gender),
        maritalStatus: formatMaritalStatusLabel(member.maritalStatus),
      })),
    };
  }

  async exportMyMemberData(userId: string, churchId: string) {
    const member = await this.prisma.member.findFirst({
      where: { churchId, userId, deletedAt: null },
      include: {
        ministryLinks: {
          include: {
            ministry: { select: { id: true, name: true } },
            roleAssignments: {
              include: {
                ministryRole: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });

    if (!member) {
      throw new NotFoundException('Perfil de membro não encontrado.');
    }

    return {
      exportedAt: new Date().toISOString(),
      member: {
        id: member.id,
        name: member.name,
        email: member.email,
        cpf: member.cpf,
        phone: member.phone,
        phoneSecondary: member.phoneSecondary,
        birthDate: member.birthDate,
        status: formatMemberStatusLabel(member.status),
        address: {
          street: member.street,
          number: member.number,
          complement: member.complement,
          neighborhood: member.neighborhood,
          city: member.city,
          state: member.state,
          zipCode: member.zipCode,
        },
        ministries: member.ministryLinks.map((link) => ({
          ministryId: link.ministry.id,
          ministryName: link.ministry.name,
          roles: link.roleAssignments.map((r) => r.ministryRole.name),
        })),
      },
    };
  }

  async exportChurchData(churchId: string) {
    const [church, members, families, ministries, announcements] =
      await Promise.all([
        this.prisma.church.findUniqueOrThrow({
          where: { id: churchId },
          select: {
            id: true,
            name: true,
            slug: true,
            memberCount: true,
            planTier: true,
            subscriptionStatus: true,
            createdAt: true,
            dpaAcceptedAt: true,
            dpaVersion: true,
          },
        }),
        this.prisma.member.findMany({
          where: { churchId, deletedAt: null },
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            status: true,
            createdAt: true,
          },
        }),
        this.prisma.family.findMany({
          where: { churchId },
          select: { id: true, name: true, createdAt: true },
        }),
        this.prisma.ministry.findMany({
          where: { churchId },
          select: { id: true, name: true, description: true },
        }),
        this.prisma.announcement.findMany({
          where: { churchId, deletedAt: null },
          select: {
            id: true,
            title: true,
            body: true,
            createdAt: true,
          },
          take: 500,
        }),
      ]);

    return {
      exportedAt: new Date().toISOString(),
      church: {
        ...church,
        planTier: formatPlanTierLabel(church.planTier),
        subscriptionStatus: formatSubscriptionStatusLabel(
          church.subscriptionStatus,
        ),
      },
      members: members.map((member) => ({
        ...member,
        status: formatMemberStatusLabel(member.status),
      })),
      families,
      ministries,
      announcements,
    };
  }

  async exportUserAccount(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        id: true,
        name: true,
        email: true,
        cpf: true,
        createdAt: true,
        emailVerifiedAt: true,
        memberships: {
          select: {
            isOwner: true,
            createdAt: true,
            church: { select: { id: true, name: true, slug: true } },
          },
        },
        memberProfiles: {
          where: { deletedAt: null },
          select: {
            id: true,
            churchId: true,
            name: true,
            status: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    return {
      exportedAt: new Date().toISOString(),
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        cpf: user.cpf,
        createdAt: user.createdAt,
        emailVerifiedAt: user.emailVerifiedAt,
        memberships: user.memberships,
        memberProfiles: user.memberProfiles.map((profile) => ({
          ...profile,
          status: formatMemberStatusLabel(profile.status),
        })),
      },
    };
  }
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

const CSV_TIME_ZONE = 'America/Sao_Paulo';

function formatMemberStatusLabel(status: string): string {
  switch (status) {
    case 'visitor':
      return 'Visitante';
    case 'active':
      return 'Ativo';
    case 'inactive':
      return 'Inativo';
    default:
      return status;
  }
}

function formatGenderLabel(gender: string | null | undefined): string | null {
  if (!gender) {
    return null;
  }

  switch (gender) {
    case 'male':
      return 'Masculino';
    case 'female':
      return 'Feminino';
    default:
      return gender;
  }
}

function formatMaritalStatusLabel(
  maritalStatus: string | null | undefined,
): string | null {
  if (!maritalStatus) {
    return null;
  }

  switch (maritalStatus) {
    case 'single':
      return 'Solteiro(a)';
    case 'married':
      return 'Casado(a)';
    case 'divorced':
      return 'Divorciado(a)';
    case 'widowed':
      return 'Viúvo(a)';
    default:
      return maritalStatus;
  }
}

function formatSubscriptionStatusLabel(status: string): string {
  switch (status) {
    case 'trialing':
      return 'Período de teste';
    case 'active':
      return 'Ativa';
    case 'past_due':
      return 'Pagamento pendente';
    case 'canceled':
      return 'Encerrada';
    default:
      return status;
  }
}

function formatPlanTierLabel(tier: string): string {
  switch (tier) {
    case 'starter':
      return 'Inicial';
    case 'small':
      return 'Pequena';
    case 'growth':
      return 'Em crescimento';
    case 'consolidated':
      return 'Consolidada';
    case 'enterprise':
      return 'Multi-congregação';
    default:
      return tier;
  }
}

function formatCsvDate(value: Date | null | undefined): string {
  if (!value) {
    return '';
  }

  const parts = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: CSV_TIME_ZONE,
  }).formatToParts(value);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';

  return `${get('day')}/${get('month')}/${get('year')}`;
}

function formatCsvDateTime(value: Date | null | undefined): string {
  if (!value) {
    return '';
  }

  const parts = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: CSV_TIME_ZONE,
  }).formatToParts(value);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';

  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
}
