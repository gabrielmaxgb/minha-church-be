import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MemberStatus, Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { generateTemporaryPassword } from '../../common/utils/credentials';
import { canonicalizeEmail } from '../../common/utils/canonicalize-email';
import { encryptSecret } from '../../common/utils/secret-encryption';
import {
  cpfToInternalEmail,
  formatCpf,
  isValidCpf,
  normalizeCpf,
} from '../../common/utils/cpf';
import { PrismaService } from '../../database/prisma.service';
import { BillingService } from '../billing/billing.service';
import { defaultMemberMinistryInstruments } from '../ministries/ministry-service-functions';
import {
  AssignMemberMinistryDto,
  AckMinistryCatalogNotificationsDto,
  CreateMemberDto,
  ListMembersQueryDto,
  UpdateMemberDto,
} from './dto/member.dto';
import {
  buildMyMinistryNotifications,
  memberNeedsServiceFunctions,
  type MyMinistryNotificationsResponse,
} from './member-ministry-notifications';
import {
  MemberWithMinistries,
  parseOptionalDate,
  toMemberResponse,
  type CreateMemberResponse,
  type MemberAccountCredentials,
  type MemberResponse,
  type ReceiveMemberResponse,
  type UpdateMemberResponse,
} from './members.types';

const memberInclude = {
  ministryLinks: {
    where: { endedAt: null },
    include: {
      ministry: true,
      roleAssignments: {
        include: {
          ministryRole: true,
        },
      },
    },
  },
} satisfies Prisma.MemberInclude;

@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly billingService: BillingService,
  ) {}

  async findAll(
    churchId: string,
    query: ListMembersQueryDto,
  ): Promise<{
    data: MemberResponse[];
    meta: { total: number; page: number; limit: number };
  }> {
    const page = Math.max(query.page ?? 1, 1);
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
    const skip = (page - 1) * limit;

    const where: Prisma.MemberWhereInput = {
      churchId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
              { cpf: { contains: normalizeCpf(query.search) } },
              { phone: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [members, total] = await Promise.all([
      this.prisma.member.findMany({
        where,
        include: memberInclude,
        orderBy: { name: 'asc' },
        skip,
        take: limit,
      }),
      this.prisma.member.count({ where }),
    ]);

    return {
      data: members.map((member) =>
        toMemberResponse(member as MemberWithMinistries),
      ),
      meta: { total, page, limit },
    };
  }

  async findOne(churchId: string, memberId: string): Promise<MemberResponse> {
    const member = await this.getMemberOrThrow(churchId, memberId);

    return toMemberResponse(member);
  }

  async findMine(userId: string, churchId: string): Promise<MemberResponse> {
    const member = await this.prisma.member.findFirst({
      where: { userId, churchId, deletedAt: null },
      include: memberInclude,
    });

    if (!member) {
      throw new NotFoundException('Cadastro pastoral não encontrado.');
    }

    return toMemberResponse(member as MemberWithMinistries);
  }

  async findMyMinistryNotifications(
    userId: string,
    churchId: string,
  ): Promise<MyMinistryNotificationsResponse> {
    const member = await this.prisma.member.findFirst({
      where: { userId, churchId, deletedAt: null },
      select: { id: true },
    });

    if (!member) {
      return buildMyMinistryNotifications([]);
    }

    const links = await this.prisma.memberMinistry.findMany({
      where: {
        memberId: member.id,
        endedAt: null,
        ministry: { churchId, isActive: true },
      },
      select: {
        instruments: true,
        serviceFunctionsCatalogSeenAt: true,
        ministry: {
          select: {
            id: true,
            name: true,
            serviceFunctionsUpdatedAt: true,
            serviceFunctions: { select: { id: true } },
          },
        },
      },
      orderBy: { ministry: { name: 'asc' } },
    });

    return buildMyMinistryNotifications(links);
  }

  async ackMinistryCatalogNotifications(
    userId: string,
    churchId: string,
    ministryIds: string[],
  ): Promise<MyMinistryNotificationsResponse> {
    const uniqueMinistryIds = [...new Set(ministryIds.filter(Boolean))];

    if (uniqueMinistryIds.length === 0) {
      return this.findMyMinistryNotifications(userId, churchId);
    }

    const member = await this.prisma.member.findFirst({
      where: { userId, churchId, deletedAt: null },
      select: { id: true },
    });

    if (!member) {
      throw new NotFoundException('Cadastro pastoral não encontrado.');
    }

    const ministries = await this.prisma.ministry.findMany({
      where: {
        id: { in: uniqueMinistryIds },
        churchId,
        isActive: true,
      },
      select: {
        id: true,
        serviceFunctionsUpdatedAt: true,
      },
    });

    await this.prisma.$transaction(
      ministries.map((ministry) =>
        this.prisma.memberMinistry.updateMany({
          where: {
            memberId: member.id,
            ministryId: ministry.id,
            endedAt: null,
          },
          data: {
            serviceFunctionsCatalogSeenAt: ministry.serviceFunctionsUpdatedAt,
          },
        }),
      ),
    );

    return this.findMyMinistryNotifications(userId, churchId);
  }

  async create(
    churchId: string,
    dto: CreateMemberDto,
  ): Promise<CreateMemberResponse> {
    const email = dto.email?.trim().toLowerCase() || null;
    const cpf = dto.cpf ? normalizeCpf(dto.cpf) : null;
    const status = dto.status ?? MemberStatus.visitor;

    if (status === MemberStatus.active && !email && !cpf) {
      throw new BadRequestException(
        'Informe e-mail ou CPF para liberar o acesso ao sistema.',
      );
    }

    if (cpf && !isValidCpf(cpf)) {
      throw new BadRequestException('CPF inválido.');
    }

    if (email) {
      await this.ensureEmailAvailable(churchId, email);
    }

    if (cpf) {
      await this.ensureCpfAvailable(churchId, cpf);
    }

    if (status === MemberStatus.active) {
      await this.ensureUserCredentialsAvailable(email, cpf);
    }

    const visitorSince =
      parseOptionalDate(dto.visitorSince) ??
      (status === MemberStatus.visitor ? new Date() : null);
    const membershipDate =
      parseOptionalDate(dto.membershipDate) ??
      (status === MemberStatus.active ? new Date() : null);

    const memberData = {
      churchId,
      name: dto.name.trim(),
      email,
      cpf,
      phone: dto.phone,
      phoneSecondary: dto.phoneSecondary,
      birthDate: parseOptionalDate(dto.birthDate),
      gender: dto.gender,
      maritalStatus: dto.maritalStatus,
      weddingAnniversary:
        dto.maritalStatus === 'married'
          ? parseOptionalDate(dto.weddingAnniversary)
          : null,
      street: dto.street,
      number: dto.number,
      complement: dto.complement,
      neighborhood: dto.neighborhood,
      city: dto.city,
      state: dto.state,
      zipCode: dto.zipCode,
      status,
      visitorSince,
      baptismDate: parseOptionalDate(dto.baptismDate),
      membershipDate,
    };

    if (status !== MemberStatus.active) {
      const member = await this.prisma.member.create({
        data: memberData,
        include: memberInclude,
      });

      await this.syncMemberCount(churchId);

      return toMemberResponse(member);
    }

    let account: MemberAccountCredentials;

    const member = await this.prisma.$transaction(async (tx) => {
      const created = await tx.member.create({
        data: memberData,
        include: memberInclude,
      });

      account = await this.provisionMemberLogin(tx, churchId, created);

      return tx.member.findUniqueOrThrow({
        where: { id: created.id },
        include: memberInclude,
      });
    });

    await this.syncMemberCount(churchId);

    return {
      ...toMemberResponse(member),
      account: account!,
    };
  }

  async update(
    churchId: string,
    memberId: string,
    dto: UpdateMemberDto,
  ): Promise<UpdateMemberResponse> {
    const existing = await this.getMemberOrThrow(churchId, memberId);

    if (dto.email && dto.email !== existing.email) {
      await this.ensureEmailAvailable(churchId, dto.email, memberId);
    }

    if (dto.cpf !== undefined) {
      const normalizedCpf = dto.cpf ? normalizeCpf(dto.cpf) : null;

      if (normalizedCpf && !isValidCpf(normalizedCpf)) {
        throw new BadRequestException('CPF inválido.');
      }

      if (normalizedCpf && normalizedCpf !== existing.cpf) {
        await this.ensureCpfAvailable(churchId, normalizedCpf, memberId);
      }
    }

    const nextStatus = dto.status ?? existing.status;
    const nextEmail =
      dto.email !== undefined
        ? (dto.email?.toLowerCase() ?? null)
        : existing.email;
    const nextCpf =
      dto.cpf !== undefined
        ? dto.cpf
          ? normalizeCpf(dto.cpf)
          : null
        : existing.cpf;

    if (
      nextStatus === MemberStatus.active &&
      !existing.userId &&
      !nextEmail &&
      !nextCpf
    ) {
      throw new BadRequestException(
        'Informe e-mail ou CPF antes de ativar o acesso ao sistema.',
      );
    }

    const maritalStatus = dto.maritalStatus ?? existing.maritalStatus;
    const previousStatus = existing.status;
    let account: MemberAccountCredentials | undefined;

    const member = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.member.update({
      where: { id: memberId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.email !== undefined
          ? { email: dto.email?.toLowerCase() ?? null }
          : {}),
        ...(dto.cpf !== undefined ? { cpf: nextCpf } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.phoneSecondary !== undefined
          ? { phoneSecondary: dto.phoneSecondary }
          : {}),
        ...(dto.birthDate !== undefined
          ? { birthDate: parseOptionalDate(dto.birthDate) }
          : {}),
        ...(dto.gender !== undefined ? { gender: dto.gender } : {}),
        ...(dto.maritalStatus !== undefined
          ? { maritalStatus: dto.maritalStatus }
          : {}),
        ...(dto.weddingAnniversary !== undefined ||
        dto.maritalStatus !== undefined
          ? {
              weddingAnniversary:
                maritalStatus === 'married'
                  ? (parseOptionalDate(dto.weddingAnniversary ?? undefined) ??
                    existing.weddingAnniversary)
                  : null,
            }
          : {}),
        ...(dto.street !== undefined ? { street: dto.street } : {}),
        ...(dto.number !== undefined ? { number: dto.number } : {}),
        ...(dto.complement !== undefined ? { complement: dto.complement } : {}),
        ...(dto.neighborhood !== undefined
          ? { neighborhood: dto.neighborhood }
          : {}),
        ...(dto.city !== undefined ? { city: dto.city } : {}),
        ...(dto.state !== undefined ? { state: dto.state } : {}),
        ...(dto.zipCode !== undefined ? { zipCode: dto.zipCode } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.visitorSince !== undefined
          ? { visitorSince: parseOptionalDate(dto.visitorSince) }
          : {}),
        ...(dto.baptismDate !== undefined
          ? { baptismDate: parseOptionalDate(dto.baptismDate) }
          : {}),
        ...(dto.membershipDate !== undefined
          ? { membershipDate: parseOptionalDate(dto.membershipDate) }
          : {}),
        ...(nextStatus === MemberStatus.active && previousStatus !== MemberStatus.active
          ? { membershipDate: new Date(), visitorSince: null }
          : {}),
      },
      include: memberInclude,
    });

      if (
        nextStatus === MemberStatus.active &&
        previousStatus !== MemberStatus.active &&
        !updated.userId
      ) {
        account = await this.provisionMemberLogin(tx, churchId, updated);
      }

      if (
        nextStatus !== MemberStatus.active &&
        updated.userId
      ) {
        await this.revokeMemberLogin(tx, churchId, memberId, updated.userId);
      }

      return tx.member.findUniqueOrThrow({
        where: { id: memberId },
        include: memberInclude,
      });
    });

    await this.syncMemberCount(churchId);

    return {
      ...toMemberResponse(member),
      ...(account ? { account } : {}),
    };
  }

  async remove(churchId: string, memberId: string): Promise<void> {
    await this.getMemberOrThrow(churchId, memberId);

    await this.prisma.member.update({
      where: { id: memberId },
      data: { deletedAt: new Date() },
    });

    await this.syncMemberCount(churchId);
  }

  async receive(
    churchId: string,
    memberId: string,
  ): Promise<ReceiveMemberResponse> {
    const member = await this.getMemberOrThrow(churchId, memberId);

    if (member.status === MemberStatus.active) {
      throw new ConflictException('Membro já foi recebido.');
    }

    if (!member.email && !member.cpf) {
      throw new BadRequestException(
        'Cadastre e-mail ou CPF antes de receber como membro.',
      );
    }

    let account: MemberAccountCredentials | undefined;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (!member.userId) {
        account = await this.provisionMemberLogin(tx, churchId, member);
      }

      return tx.member.update({
        where: { id: memberId },
        data: {
          status: MemberStatus.active,
          membershipDate: new Date(),
          visitorSince: null,
        },
        include: memberInclude,
      });
    });

    await this.syncMemberCount(churchId);

    return {
      ...toMemberResponse(updated),
      ...(account ? { account } : {}),
    };
  }

  async assignMinistry(
    churchId: string,
    memberId: string,
    dto: AssignMemberMinistryDto,
  ): Promise<MemberResponse> {
    await this.getMemberOrThrow(churchId, memberId);
    await this.ensureMinistryBelongsToChurch(churchId, dto.ministryId);

    const uniqueRoleIds =
      dto.ministryRoleIds !== undefined
        ? [...new Set(dto.ministryRoleIds)]
        : undefined;

    if (uniqueRoleIds) {
      for (const roleId of uniqueRoleIds) {
        await this.ensureRoleBelongsToMinistry(dto.ministryId, roleId);
      }
    }

    const catalog = await this.prisma.ministryServiceFunction.findMany({
      where: { ministryId: dto.ministryId },
      select: { label: true },
    });
    const defaultInstruments = defaultMemberMinistryInstruments(
      catalog.map((item) => item.label),
    );

    await this.prisma.$transaction(async (tx) => {
      const link = await tx.memberMinistry.upsert({
        where: {
          memberId_ministryId: {
            memberId,
            ministryId: dto.ministryId,
          },
        },
        update: {
          startedAt: parseOptionalDate(dto.startedAt) ?? new Date(),
          endedAt: null,
        },
        create: {
          memberId,
          ministryId: dto.ministryId,
          startedAt: parseOptionalDate(dto.startedAt) ?? new Date(),
          instruments: defaultInstruments,
        },
      });

      if (link.instruments.length === 0) {
        await tx.memberMinistry.update({
          where: { id: link.id },
          data: { instruments: defaultInstruments },
        });
      }

      if (uniqueRoleIds !== undefined) {
        await tx.memberMinistryRole.deleteMany({
          where: { memberMinistryId: link.id },
        });

        if (uniqueRoleIds.length > 0) {
          await tx.memberMinistryRole.createMany({
            data: uniqueRoleIds.map((ministryRoleId) => ({
              memberMinistryId: link.id,
              ministryRoleId,
            })),
          });
        }
      }
    });

    const member = await this.getMemberOrThrow(churchId, memberId);

    return toMemberResponse(member);
  }

  async removeMinistry(
    churchId: string,
    memberId: string,
    ministryId: string,
  ): Promise<MemberResponse> {
    await this.getMemberOrThrow(churchId, memberId);

    const link = await this.prisma.memberMinistry.findUnique({
      where: {
        memberId_ministryId: {
          memberId,
          ministryId,
        },
      },
    });

    if (!link) {
      throw new NotFoundException('Vínculo com ministério não encontrado.');
    }

    await this.prisma.memberMinistry.update({
      where: { id: link.id },
      data: { endedAt: new Date() },
    });

    const member = await this.getMemberOrThrow(churchId, memberId);

    return toMemberResponse(member);
  }

  private async getMemberOrThrow(
    churchId: string,
    memberId: string,
  ): Promise<MemberWithMinistries> {
    const member = await this.prisma.member.findFirst({
      where: { id: memberId, churchId, deletedAt: null },
      include: memberInclude,
    });

    if (!member) {
      throw new NotFoundException('Membro não encontrado.');
    }

    return member;
  }

  private async ensureEmailAvailable(
    churchId: string,
    email: string,
    excludeMemberId?: string,
  ) {
    const existing = await this.prisma.member.findFirst({
      where: {
        churchId,
        email: email.toLowerCase(),
        deletedAt: null,
        ...(excludeMemberId ? { NOT: { id: excludeMemberId } } : {}),
      },
    });

    if (existing) {
      throw new ConflictException('E-mail já cadastrado nesta igreja.');
    }
  }

  private async ensureCpfAvailable(
    churchId: string,
    cpf: string,
    excludeMemberId?: string,
  ) {
    const existing = await this.prisma.member.findFirst({
      where: {
        churchId,
        cpf,
        deletedAt: null,
        ...(excludeMemberId ? { NOT: { id: excludeMemberId } } : {}),
      },
    });

    if (existing) {
      throw new ConflictException('CPF já cadastrado nesta igreja.');
    }
  }

  private async ensureUserCredentialsAvailable(
    email: string | null,
    cpf: string | null,
  ) {
    if (email) {
      const existingUser = await this.prisma.user.findUnique({
        where: { email },
      });

      if (existingUser) {
        throw new ConflictException('E-mail já possui login no sistema.');
      }
    }

    if (cpf) {
      const existingUser = await this.prisma.user.findUnique({
        where: { cpf },
      });

      if (existingUser) {
        throw new ConflictException('CPF já possui login no sistema.');
      }
    }
  }

  private async ensureMinistryBelongsToChurch(
    churchId: string,
    ministryId: string,
  ) {
    const ministry = await this.prisma.ministry.findFirst({
      where: { id: ministryId, churchId, isActive: true },
    });

    if (!ministry) {
      throw new NotFoundException('Ministério não encontrado.');
    }
  }

  private async ensureRoleBelongsToMinistry(
    ministryId: string,
    ministryRoleId: string,
  ) {
    const role = await this.prisma.ministryRole.findFirst({
      where: { id: ministryRoleId, ministryId },
    });

    if (!role) {
      throw new NotFoundException('Cargo do ministério não encontrado.');
    }
  }

  private async provisionMemberLogin(
    tx: Prisma.TransactionClient,
    churchId: string,
    member: {
      id: string;
      name: string;
      email: string | null;
      cpf: string | null;
      userId: string | null;
    },
  ): Promise<MemberAccountCredentials> {
    const email = member.email?.trim().toLowerCase() || null;
    const cpf = member.cpf;

    if (!email && !cpf) {
      throw new BadRequestException(
        'Informe e-mail ou CPF para liberar o acesso ao sistema.',
      );
    }

    if (member.userId) {
      const existingMembership = await tx.churchMembership.findUnique({
        where: {
          userId_churchId: {
            userId: member.userId,
            churchId,
          },
        },
      });

      if (existingMembership) {
        throw new ConflictException('Membro já possui acesso ao sistema.');
      }
    }

    await this.ensureUserCredentialsAvailable(email, cpf);

    const userEmail = email ?? cpfToInternalEmail(cpf!);
    const loginIdentifier = email ?? formatCpf(cpf!);
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);
    const temporaryPasswordEnc = encryptSecret(
      temporaryPassword,
      this.config.get<string>('jwt.secret') ?? '',
    );

    const memberRole = await tx.churchRole.findFirst({
      where: { churchId, systemKey: 'member' },
    });

    const user = await tx.user.create({
      data: {
        email: userEmail,
        emailCanonical: canonicalizeEmail(userEmail),
        cpf,
        name: member.name,
        passwordHash,
        mustChangePassword: true,
        temporaryPasswordEnc,
        emailVerifiedAt: new Date(),
      },
    });

    await tx.churchMembership.create({
      data: {
        userId: user.id,
        churchId,
        isOwner: false,
        ...(memberRole
          ? {
              roleAssignments: {
                create: [{ roleId: memberRole.id }],
              },
            }
          : {}),
      },
    });

    await tx.member.update({
      where: { id: member.id },
      data: { userId: user.id },
    });

    return {
      login: loginIdentifier,
      temporaryPassword,
      mustChangePassword: true,
    };
  }

  private async revokeMemberLogin(
    tx: Prisma.TransactionClient,
    churchId: string,
    memberId: string,
    userId: string,
  ): Promise<void> {
    const membership = await tx.churchMembership.findUnique({
      where: {
        userId_churchId: {
          userId,
          churchId,
        },
      },
      include: {
        roleAssignments: {
          include: { role: true },
        },
      },
    });

    if (!membership) {
      await tx.member.update({
        where: { id: memberId },
        data: { userId: null },
      });

      return;
    }

    if (membership.isOwner) {
      throw new BadRequestException(
        'Não é possível remover o acesso de um proprietário por aqui.',
      );
    }

    const hasNonMemberRole = membership.roleAssignments.some(
      (assignment) =>
        assignment.role.systemKey && assignment.role.systemKey !== 'member',
    );

    if (hasNonMemberRole) {
      throw new BadRequestException(
        'Este usuário possui cargos administrativos. Ajuste o acesso em Configurações.',
      );
    }

    await tx.churchMembershipRole.deleteMany({
      where: { membershipId: membership.id },
    });

    await tx.churchMembership.delete({
      where: { id: membership.id },
    });

    await tx.member.update({
      where: { id: memberId },
      data: { userId: null },
    });
  }

  private async syncMemberCount(churchId: string) {
    const count = await this.prisma.member.count({
      where: {
        churchId,
        deletedAt: null,
        status: { in: [MemberStatus.active, MemberStatus.visitor] },
      },
    });

    await this.prisma.church.update({
      where: { id: churchId },
      data: { memberCount: count },
    });

    await this.billingService.syncSubscriptionTierForMemberCount(churchId);
  }

  /**
   * Garante cadastro pastoral (tabela members) para quem tem acesso à igreja.
   * Acesso (church_memberships) e lista de Membros são registros separados.
   */
  async ensurePastoralRecordForUser(
    churchId: string,
    userId: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      return;
    }

    const email = user.email.trim().toLowerCase();

    const existing = await this.prisma.member.findFirst({
      where: {
        churchId,
        deletedAt: null,
        OR: [{ userId }, { email }],
      },
    });

    if (existing) {
      if (existing.userId !== userId || existing.name !== user.name) {
        await this.prisma.member.update({
          where: { id: existing.id },
          data: {
            userId,
            name: user.name,
            status: MemberStatus.active,
            membershipDate: existing.membershipDate ?? new Date(),
            deletedAt: null,
          },
        });
      }

      return;
    }

    await this.prisma.member.create({
      data: {
        churchId,
        userId,
        name: user.name,
        email,
        status: MemberStatus.active,
        membershipDate: new Date(),
      },
    });

    await this.syncMemberCount(churchId);
  }
}
