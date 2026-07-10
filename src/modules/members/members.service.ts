import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
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
import { ChurchPermissionsService } from '../../common/services/church-permissions.service';
import { EmailService } from '../../common/services/email.service';
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
  type FamilyGraphResponse,
  type FamilyResponse,
  type MemberAccountCredentials,
  type MemberRelationResponse,
  type MemberResponse,
  type ReceiveMemberResponse,
  type UpdateMemberResponse,
} from './members.types';

const memberInclude = {
  family: true,
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
  private readonly logger = new Logger(MembersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly billingService: BillingService,
    private readonly emailService: EmailService,
    private readonly churchPermissions: ChurchPermissionsService,
  ) {}

  async findAll(
    churchId: string,
    query: ListMembersQueryDto,
    userId: string,
  ): Promise<{
    data: MemberResponse[];
    meta: { total: number; page: number; limit: number };
  }> {
    const canList = await this.churchPermissions.canListChurchMembers(
      userId,
      churchId,
    );

    if (!canList) {
      throw new ForbiddenException('Permissão insuficiente.');
    }
    const page = Math.max(query.page ?? 1, 1);
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
    const skip = (page - 1) * limit;

    const where: Prisma.MemberWhereInput = {
      churchId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.familyId === 'none'
        ? { familyId: null }
        : query.familyId
          ? { familyId: query.familyId }
          : {}),
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
      await this.assertActiveMemberTierAllowed(churchId);
    }

    const familyId = await this.resolveFamilyId(churchId, dto.familyId);

    const visitorSince =
      parseOptionalDate(dto.visitorSince) ??
      (status === MemberStatus.visitor ? new Date() : null);
    const membershipDate =
      parseOptionalDate(dto.membershipDate) ??
      (status === MemberStatus.active ? new Date() : null);

    const memberData = {
      churchId,
      familyId,
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

    let account!: MemberAccountCredentials;

    const member = await this.prisma.$transaction(async (tx) => {
      const created = await tx.member.create({
        data: memberData,
        include: memberInclude,
      });

      const provisioned = await this.syncMemberAppAccess(tx, churchId, created);

      if (!provisioned) {
        throw new BadRequestException(
          'Não foi possível liberar o acesso ao sistema.',
        );
      }

      account = provisioned;

      return tx.member.findUniqueOrThrow({
        where: { id: created.id },
        include: memberInclude,
      });
    });

    await this.syncMemberCount(churchId);

    if (account.kind === 'linked') {
      await this.notifyExistingUserLinkedToChurch(churchId, account.login);
    }

    return {
      ...toMemberResponse(member),
      account,
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

    if (
      nextStatus === MemberStatus.active &&
      existing.status !== MemberStatus.active
    ) {
      await this.assertActiveMemberTierAllowed(churchId);
    }

    if (nextStatus !== MemberStatus.active && existing.userId) {
      await this.assertCanLeaveActiveStatus(churchId, existing.userId);
    }

    const maritalStatus = dto.maritalStatus ?? existing.maritalStatus;
    const previousStatus = existing.status;
    let account: MemberAccountCredentials | undefined;

    const nextFamilyId =
      dto.familyId !== undefined
        ? await this.resolveFamilyId(churchId, dto.familyId)
        : undefined;

    const member = await this.prisma.$transaction(async (tx) => {
      if (
        nextFamilyId !== undefined &&
        existing.familyId &&
        nextFamilyId !== existing.familyId
      ) {
        await tx.memberRelation.deleteMany({
          where: {
            churchId,
            OR: [{ fromMemberId: memberId }, { toMemberId: memberId }],
          },
        });
      }

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
        ...(nextFamilyId !== undefined ? { familyId: nextFamilyId } : {}),
        ...(nextStatus === MemberStatus.active && previousStatus !== MemberStatus.active
          ? { membershipDate: new Date(), visitorSince: null }
          : {}),
      },
      include: memberInclude,
    });

      account = await this.syncMemberAppAccess(tx, churchId, updated);

      return tx.member.findUniqueOrThrow({
        where: { id: memberId },
        include: memberInclude,
      });
    });

    await this.syncMemberCount(churchId);

    if (account?.kind === 'linked') {
      await this.notifyExistingUserLinkedToChurch(churchId, account.login);
    }

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

    await this.assertActiveMemberTierAllowed(churchId);

    let account: MemberAccountCredentials | undefined;

    const updated = await this.prisma.$transaction(async (tx) => {
      const received = await tx.member.update({
        where: { id: memberId },
        data: {
          status: MemberStatus.active,
          membershipDate: new Date(),
          visitorSince: null,
        },
        include: memberInclude,
      });

      account = await this.syncMemberAppAccess(tx, churchId, received);

      return tx.member.findUniqueOrThrow({
        where: { id: memberId },
        include: memberInclude,
      });
    });

    await this.syncMemberCount(churchId);

    if (account?.kind === 'linked') {
      await this.notifyExistingUserLinkedToChurch(churchId, account.login);
    }

    return {
      ...toMemberResponse(updated),
      ...(account ? { account } : {}),
    };
  }

  async assignMinistry(
    churchId: string,
    memberId: string,
    userId: string,
    dto: AssignMemberMinistryDto,
  ): Promise<MemberResponse> {
    await this.assertCanManageMinistryTeam(userId, churchId, dto.ministryId);
    await this.getMemberOrThrow(churchId, memberId);
    await this.ensureMinistryBelongsToChurch(churchId, dto.ministryId);

    const uniqueRoleIds =
      dto.ministryRoleIds !== undefined
        ? [...new Set(dto.ministryRoleIds)]
        : undefined;

    if (uniqueRoleIds) {
      const roles = await this.prisma.ministryRole.findMany({
        where: { ministryId: dto.ministryId, id: { in: uniqueRoleIds } },
        select: {
          id: true,
          name: true,
          singleHolder: true,
        },
      });

      if (roles.length !== uniqueRoleIds.length) {
        throw new NotFoundException('Cargo do ministério não encontrado.');
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
        const singleHolderRoles = await tx.ministryRole.findMany({
          where: {
            id: { in: uniqueRoleIds },
            singleHolder: true,
          },
          select: { id: true },
        });

        for (const role of singleHolderRoles) {
          await tx.memberMinistryRole.deleteMany({
            where: {
              ministryRoleId: role.id,
              memberMinistryId: { not: link.id },
              memberMinistry: {
                ministryId: dto.ministryId,
                endedAt: null,
              },
            },
          });
        }

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
    userId: string,
  ): Promise<MemberResponse> {
    await this.assertCanManageMinistryTeam(userId, churchId, ministryId);
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

  private async assertCanManageMinistryTeam(
    userId: string,
    churchId: string,
    ministryId: string,
  ) {
    const allowed = await this.churchPermissions.canManageMinistryTeam(
      userId,
      churchId,
      ministryId,
    );

    if (!allowed) {
      throw new ForbiddenException(
        'Sem permissão para gerenciar a equipe deste ministério.',
      );
    }
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

    const existingUser = await this.findExistingUserForLogin(tx, email, cpf);

    if (existingUser) {
      return this.linkExistingUserLogin(tx, churchId, member.id, existingUser, {
        email,
        cpf,
      });
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
      kind: 'created',
      login: loginIdentifier,
      temporaryPassword,
      mustChangePassword: true,
    };
  }

  private async findExistingUserForLogin(
    tx: Prisma.TransactionClient,
    email: string | null,
    cpf: string | null,
  ): Promise<{
    id: string;
    email: string;
    cpf: string | null;
    name: string;
  } | null> {
    if (email) {
      const userByEmail = await tx.user.findUnique({
        where: { email },
        select: { id: true, email: true, cpf: true, name: true },
      });

      if (!userByEmail) {
        if (cpf) {
          const userByCpf = await tx.user.findUnique({
            where: { cpf },
            select: { id: true, email: true, cpf: true, name: true },
          });

          if (userByCpf) {
            this.assertLoginIdentityConsistent(userByCpf, email, cpf);
            return userByCpf;
          }
        }

        return null;
      }

      this.assertLoginIdentityConsistent(userByEmail, email, cpf);

      if (cpf) {
        const userByCpf = await tx.user.findUnique({
          where: { cpf },
          select: { id: true },
        });

        if (userByCpf && userByCpf.id !== userByEmail.id) {
          throw new ConflictException(
            'E-mail e CPF pertencem a contas diferentes no sistema.',
          );
        }
      }

      return userByEmail;
    }

    if (cpf) {
      const userByCpf = await tx.user.findUnique({
        where: { cpf },
        select: { id: true, email: true, cpf: true, name: true },
      });

      if (!userByCpf) {
        return null;
      }

      this.assertLoginIdentityConsistent(userByCpf, email, cpf);
      return userByCpf;
    }

    return null;
  }

  private assertLoginIdentityConsistent(
    user: { email: string; cpf: string | null },
    memberEmail: string | null,
    memberCpf: string | null,
  ): void {
    if (
      memberCpf &&
      user.cpf &&
      normalizeCpf(memberCpf) !== normalizeCpf(user.cpf)
    ) {
      throw new ConflictException(
        'O CPF informado não corresponde à conta existente com este e-mail.',
      );
    }

    if (
      memberEmail &&
      user.email &&
      !this.isCpfInternalEmail(user.email) &&
      user.email.trim().toLowerCase() !== memberEmail
    ) {
      throw new ConflictException(
        'O e-mail informado não corresponde à conta existente com este CPF.',
      );
    }
  }

  private isCpfInternalEmail(email: string): boolean {
    return email.endsWith('@accounts.minhachurch.app');
  }

  private async linkExistingUserLogin(
    tx: Prisma.TransactionClient,
    churchId: string,
    memberId: string,
    user: { id: string; email: string; cpf: string | null },
    identifiers: { email: string | null; cpf: string | null },
  ): Promise<MemberAccountCredentials> {
    const existingMembership = await tx.churchMembership.findUnique({
      where: {
        userId_churchId: {
          userId: user.id,
          churchId,
        },
      },
    });

    if (existingMembership) {
      throw new ConflictException(
        'Esta conta já possui acesso a esta igreja.',
      );
    }

    const linkedMember = await tx.member.findFirst({
      where: {
        churchId,
        userId: user.id,
        deletedAt: null,
        NOT: { id: memberId },
      },
      select: { id: true },
    });

    if (linkedMember) {
      throw new ConflictException(
        'Já existe um cadastro nesta igreja vinculado a esta conta.',
      );
    }

    const memberRole = await tx.churchRole.findFirst({
      where: { churchId, systemKey: 'member' },
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
      where: { id: memberId },
      data: { userId: user.id },
    });

    const login =
      identifiers.email ??
      (identifiers.cpf ? formatCpf(identifiers.cpf) : user.email);

    return {
      kind: 'linked',
      login,
      linkedExistingAccount: true,
    };
  }

  private async notifyExistingUserLinkedToChurch(
    churchId: string,
    login: string,
  ): Promise<void> {
    const church = await this.prisma.church.findUnique({
      where: { id: churchId },
      select: { name: true },
    });

    if (!church) {
      return;
    }

    const email = login.includes('@') ? login.trim().toLowerCase() : null;

    if (!email || this.isCpfInternalEmail(email)) {
      return;
    }

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { name: true, email: true },
    });

    if (!user) {
      return;
    }

    const appUrl = this.config.get<string>('appUrl') ?? 'http://localhost:3000';

    try {
      await this.emailService.sendMemberAccountLinkedEmail(user.email, {
        userName: user.name,
        churchName: church.name,
        login: user.email,
        appUrl,
      });
    } catch (error) {
      this.logger.warn(
        `Falha ao enviar e-mail de vínculo de conta (${churchId}): ${
          error instanceof Error ? error.message : 'erro desconhecido'
        }`,
      );
    }
  }

  /**
   * Fonte da verdade: Member.status === active ⇔ ChurchMembership + cargo `member`.
   * Owner nunca perde membership por mudança de status pastoral.
   */
  private async syncMemberAppAccess(
    tx: Prisma.TransactionClient,
    churchId: string,
    member: {
      id: string;
      name: string;
      email: string | null;
      cpf: string | null;
      userId: string | null;
      status: MemberStatus;
    },
  ): Promise<MemberAccountCredentials | undefined> {
    if (member.status === MemberStatus.active) {
      if (!member.userId) {
        return this.provisionMemberLogin(tx, churchId, member);
      }

      await this.ensureMembershipWithMemberRole(tx, churchId, member.userId);

      return undefined;
    }

    if (!member.userId) {
      return undefined;
    }

    await this.revokeMemberLogin(tx, churchId, member.id, member.userId);

    return undefined;
  }

  private async assertCanLeaveActiveStatus(
    churchId: string,
    userId: string,
  ): Promise<void> {
    const membership = await this.prisma.churchMembership.findUnique({
      where: {
        userId_churchId: {
          userId,
          churchId,
        },
      },
      select: { isOwner: true },
    });

    if (membership?.isOwner) {
      throw new BadRequestException(
        'Não é possível alterar o status pastoral do proprietário para visitante ou inativo.',
      );
    }
  }

  async ensureMembershipWithMemberRole(
    tx: Prisma.TransactionClient | PrismaService,
    churchId: string,
    userId: string,
  ): Promise<void> {
    const memberRole = await tx.churchRole.findFirst({
      where: { churchId, systemKey: 'member' },
      select: { id: true },
    });

    const membership = await tx.churchMembership.findUnique({
      where: {
        userId_churchId: {
          userId,
          churchId,
        },
      },
      select: { id: true },
    });

    if (!membership) {
      await tx.churchMembership.create({
        data: {
          userId,
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

      return;
    }

    if (!memberRole) {
      return;
    }

    await tx.churchMembershipRole.createMany({
      data: [
        {
          membershipId: membership.id,
          roleId: memberRole.id,
        },
      ],
      skipDuplicates: true,
    });
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

  private async assertActiveMemberTierAllowed(churchId: string): Promise<void> {
    const church = await this.prisma.church.findUnique({
      where: { id: churchId },
      select: { memberCount: true },
    });

    if (!church) {
      throw new NotFoundException('Igreja não encontrada.');
    }

    await this.billingService.assertActiveMemberIncreaseAllowed(
      churchId,
      church.memberCount + 1,
    );
  }

  private async syncMemberCount(churchId: string) {
    const count = await this.prisma.member.count({
      where: {
        churchId,
        deletedAt: null,
        status: MemberStatus.active,
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
      if (
        existing.userId !== userId ||
        existing.name !== user.name ||
        existing.status !== MemberStatus.active
      ) {
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
    } else {
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

    await this.ensureMembershipWithMemberRole(this.prisma, churchId, userId);
  }

  async listFamilies(
    churchId: string,
    userId: string,
  ): Promise<FamilyResponse[]> {
    const canList = await this.churchPermissions.canListChurchMembers(
      userId,
      churchId,
    );

    if (!canList) {
      throw new ForbiddenException('Permissão insuficiente.');
    }

    const families = await this.prisma.family.findMany({
      where: { churchId },
      include: {
        _count: {
          select: {
            members: { where: { deletedAt: null } },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return families.map((family) => ({
      id: family.id,
      churchId: family.churchId,
      name: family.name,
      memberCount: family._count.members,
      createdAt: family.createdAt.toISOString(),
      updatedAt: family.updatedAt.toISOString(),
    }));
  }

  async createFamily(
    churchId: string,
    name: string,
  ): Promise<FamilyResponse> {
    const trimmed = name.trim();

    if (trimmed.length < 2) {
      throw new BadRequestException('Informe um nome de família com pelo menos 2 caracteres.');
    }

    try {
      const family = await this.prisma.family.create({
        data: {
          churchId,
          name: trimmed,
        },
      });

      return {
        id: family.id,
        churchId: family.churchId,
        name: family.name,
        memberCount: 0,
        createdAt: family.createdAt.toISOString(),
        updatedAt: family.updatedAt.toISOString(),
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Já existe uma família com esse nome.');
      }

      throw error;
    }
  }

  private async resolveFamilyId(
    churchId: string,
    familyId?: string | null,
  ): Promise<string | null | undefined> {
    if (familyId === undefined) {
      return undefined;
    }

    if (familyId === null || familyId === '') {
      return null;
    }

    const family = await this.prisma.family.findFirst({
      where: { id: familyId, churchId },
      select: { id: true },
    });

    if (!family) {
      throw new BadRequestException('Família não encontrada nesta igreja.');
    }

    return family.id;
  }

  async getFamilyGraph(
    churchId: string,
    familyId: string,
    userId: string,
  ): Promise<FamilyGraphResponse> {
    const canList = await this.churchPermissions.canListChurchMembers(
      userId,
      churchId,
    );

    if (!canList) {
      throw new ForbiddenException('Permissão insuficiente.');
    }

    const family = await this.prisma.family.findFirst({
      where: { id: familyId, churchId },
    });

    if (!family) {
      throw new NotFoundException('Família não encontrada.');
    }

    const members = await this.prisma.member.findMany({
      where: { churchId, familyId, deletedAt: null },
      select: { id: true, name: true, status: true },
      orderBy: { name: 'asc' },
    });

    const memberIds = members.map((member) => member.id);

    const relations =
      memberIds.length === 0
        ? []
        : await this.prisma.memberRelation.findMany({
            where: {
              churchId,
              fromMemberId: { in: memberIds },
              toMemberId: { in: memberIds },
            },
            orderBy: { createdAt: 'asc' },
          });

    return {
      family: { id: family.id, name: family.name },
      members,
      relations: relations.map((relation) => ({
        id: relation.id,
        fromMemberId: relation.fromMemberId,
        toMemberId: relation.toMemberId,
        type: relation.type,
        createdAt: relation.createdAt.toISOString(),
      })),
    };
  }

  async createMemberRelation(
    churchId: string,
    familyId: string,
    dto: { fromMemberId: string; toMemberId: string; type: 'spouse' | 'parent' },
  ): Promise<MemberRelationResponse> {
    if (dto.fromMemberId === dto.toMemberId) {
      throw new BadRequestException('Escolha duas pessoas diferentes.');
    }

    const family = await this.prisma.family.findFirst({
      where: { id: familyId, churchId },
      select: { id: true },
    });

    if (!family) {
      throw new NotFoundException('Família não encontrada.');
    }

    const members = await this.prisma.member.findMany({
      where: {
        churchId,
        familyId,
        deletedAt: null,
        id: { in: [dto.fromMemberId, dto.toMemberId] },
      },
      select: { id: true },
    });

    if (members.length !== 2) {
      throw new BadRequestException(
        'As duas pessoas precisam pertencer a esta família.',
      );
    }

    let fromMemberId = dto.fromMemberId;
    let toMemberId = dto.toMemberId;

    // Cônjuge: guarda uma aresta canônica (ordem estável) e impede duplicata invertida.
    if (dto.type === 'spouse') {
      const ordered = [dto.fromMemberId, dto.toMemberId].sort();
      fromMemberId = ordered[0];
      toMemberId = ordered[1];

      const existingSpouse = await this.prisma.memberRelation.findFirst({
        where: {
          churchId,
          type: 'spouse',
          OR: [
            { fromMemberId, toMemberId },
            { fromMemberId: toMemberId, toMemberId: fromMemberId },
          ],
        },
      });

      if (existingSpouse) {
        throw new ConflictException('Essas pessoas já estão como cônjuges.');
      }
    }

    try {
      const relation = await this.prisma.memberRelation.create({
        data: {
          churchId,
          fromMemberId,
          toMemberId,
          type: dto.type,
        },
      });

      return {
        id: relation.id,
        fromMemberId: relation.fromMemberId,
        toMemberId: relation.toMemberId,
        type: relation.type,
        createdAt: relation.createdAt.toISOString(),
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Esse vínculo já existe.');
      }

      throw error;
    }
  }

  async deleteMemberRelation(
    churchId: string,
    familyId: string,
    relationId: string,
  ): Promise<void> {
    const relation = await this.prisma.memberRelation.findFirst({
      where: { id: relationId, churchId },
      include: {
        fromMember: { select: { familyId: true } },
        toMember: { select: { familyId: true } },
      },
    });

    if (
      !relation ||
      relation.fromMember.familyId !== familyId ||
      relation.toMember.familyId !== familyId
    ) {
      throw new NotFoundException('Vínculo não encontrado nesta família.');
    }

    await this.prisma.memberRelation.delete({ where: { id: relationId } });
  }
}
