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
import { encryptSecret } from '../../common/utils/secret-encryption';
import {
  cpfToInternalEmail,
  formatCpf,
  isValidCpf,
  normalizeCpf,
} from '../../common/utils/cpf';
import { PrismaService } from '../../database/prisma.service';
import {
  AssignMemberMinistryDto,
  CreateMemberDto,
  ListMembersQueryDto,
  UpdateMemberDto,
} from './dto/member.dto';
import {
  MemberWithMinistries,
  parseOptionalDate,
  toMemberResponse,
  type CreateMemberResponse,
  type MemberResponse,
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
  ) {}

  async findAll(
    churchId: string,
    query: ListMembersQueryDto,
  ): Promise<{ data: MemberResponse[]; meta: { total: number; page: number; limit: number } }> {
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
      data: members.map((member) => toMemberResponse(member as MemberWithMinistries)),
      meta: { total, page, limit },
    };
  }

  async findOne(churchId: string, memberId: string): Promise<MemberResponse> {
    const member = await this.getMemberOrThrow(churchId, memberId);

    return toMemberResponse(member);
  }

  async create(churchId: string, dto: CreateMemberDto): Promise<CreateMemberResponse> {
    const email = dto.email?.trim().toLowerCase() || null;
    const cpf = dto.cpf ? normalizeCpf(dto.cpf) : null;

    if (!email && !cpf) {
      throw new BadRequestException('Informe e-mail ou CPF para criar o login.');
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

    await this.ensureUserCredentialsAvailable(email, cpf);

    const status = dto.status ?? MemberStatus.visitor;
    const visitorSince =
      parseOptionalDate(dto.visitorSince) ??
      (status === MemberStatus.visitor ? new Date() : null);
    const membershipDate =
      parseOptionalDate(dto.membershipDate) ??
      (status === MemberStatus.active ? new Date() : null);

    const userEmail = email ?? cpfToInternalEmail(cpf!);
    const loginIdentifier = email ?? formatCpf(cpf!);
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);
    const temporaryPasswordEnc = encryptSecret(
      temporaryPassword,
      this.config.get<string>('jwt.secret') ?? '',
    );

    const memberRole = await this.prisma.churchRole.findFirst({
      where: { churchId, systemKey: 'member' },
    });

    const member = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: userEmail,
          cpf,
          name: dto.name.trim(),
          passwordHash,
          mustChangePassword: true,
          temporaryPasswordEnc,
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

      return tx.member.create({
        data: {
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
          userId: user.id,
        },
        include: memberInclude,
      });
    });

    await this.syncMemberCount(churchId);

    return {
      ...toMemberResponse(member as MemberWithMinistries),
      account: {
        login: loginIdentifier,
        temporaryPassword,
        mustChangePassword: true,
      },
    };
  }

  async update(
    churchId: string,
    memberId: string,
    dto: UpdateMemberDto,
  ): Promise<MemberResponse> {
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

    const maritalStatus = dto.maritalStatus ?? existing.maritalStatus;
    const nextCpf =
      dto.cpf !== undefined
        ? dto.cpf
          ? normalizeCpf(dto.cpf)
          : null
        : existing.cpf;

    const member = await this.prisma.member.update({
      where: { id: memberId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.email !== undefined ? { email: dto.email?.toLowerCase() ?? null } : {}),
        ...(dto.cpf !== undefined ? { cpf: nextCpf } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.phoneSecondary !== undefined ? { phoneSecondary: dto.phoneSecondary } : {}),
        ...(dto.birthDate !== undefined
          ? { birthDate: parseOptionalDate(dto.birthDate) }
          : {}),
        ...(dto.gender !== undefined ? { gender: dto.gender } : {}),
        ...(dto.maritalStatus !== undefined ? { maritalStatus: dto.maritalStatus } : {}),
        ...(dto.weddingAnniversary !== undefined || dto.maritalStatus !== undefined
          ? {
              weddingAnniversary:
                maritalStatus === 'married'
                  ? parseOptionalDate(dto.weddingAnniversary ?? undefined) ??
                    existing.weddingAnniversary
                  : null,
            }
          : {}),
        ...(dto.street !== undefined ? { street: dto.street } : {}),
        ...(dto.number !== undefined ? { number: dto.number } : {}),
        ...(dto.complement !== undefined ? { complement: dto.complement } : {}),
        ...(dto.neighborhood !== undefined ? { neighborhood: dto.neighborhood } : {}),
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
      },
      include: memberInclude,
    });

    await this.syncMemberCount(churchId);

    return toMemberResponse(member as MemberWithMinistries);
  }

  async remove(churchId: string, memberId: string): Promise<void> {
    await this.getMemberOrThrow(churchId, memberId);

    await this.prisma.member.update({
      where: { id: memberId },
      data: { deletedAt: new Date() },
    });

    await this.syncMemberCount(churchId);
  }

  async receive(churchId: string, memberId: string): Promise<MemberResponse> {
    const member = await this.getMemberOrThrow(churchId, memberId);

    if (member.status === MemberStatus.active) {
      throw new ConflictException('Membro já foi recebido.');
    }

    const updated = await this.prisma.member.update({
      where: { id: memberId },
      data: {
        status: MemberStatus.active,
        membershipDate: new Date(),
      },
      include: memberInclude,
    });

    await this.syncMemberCount(churchId);

    return toMemberResponse(updated as MemberWithMinistries);
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
        },
      });

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

    return member as MemberWithMinistries;
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

  private async ensureMinistryBelongsToChurch(churchId: string, ministryId: string) {
    const ministry = await this.prisma.ministry.findFirst({
      where: { id: ministryId, churchId, isActive: true },
    });

    if (!ministry) {
      throw new NotFoundException('Ministério não encontrado.');
    }
  }

  private async ensureRoleBelongsToMinistry(ministryId: string, ministryRoleId: string) {
    const role = await this.prisma.ministryRole.findFirst({
      where: { id: ministryRoleId, ministryId },
    });

    if (!role) {
      throw new NotFoundException('Cargo do ministério não encontrado.');
    }
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
  }
}
