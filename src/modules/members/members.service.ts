import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MemberStatus, Prisma } from '@prisma/client';

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
  type MemberResponse,
} from './members.types';

const memberInclude = {
  ministryLinks: {
    where: { endedAt: null },
    include: {
      ministry: true,
      ministryRole: true,
    },
  },
} satisfies Prisma.MemberInclude;

@Injectable()
export class MembersService {
  constructor(private readonly prisma: PrismaService) {}

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

  async create(churchId: string, dto: CreateMemberDto): Promise<MemberResponse> {
    const status = dto.status ?? MemberStatus.visitor;
    const visitorSince =
      parseOptionalDate(dto.visitorSince) ??
      (status === MemberStatus.visitor ? new Date() : null);
    const membershipDate =
      parseOptionalDate(dto.membershipDate) ??
      (status === MemberStatus.active ? new Date() : null);

    if (dto.email) {
      await this.ensureEmailAvailable(churchId, dto.email);
    }

    const member = await this.prisma.member.create({
      data: {
        churchId,
        name: dto.name.trim(),
        email: dto.email?.toLowerCase(),
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
      },
      include: memberInclude,
    });

    await this.syncMemberCount(churchId);

    return toMemberResponse(member as MemberWithMinistries);
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

    const maritalStatus = dto.maritalStatus ?? existing.maritalStatus;

    const member = await this.prisma.member.update({
      where: { id: memberId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.email !== undefined ? { email: dto.email?.toLowerCase() ?? null } : {}),
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

    if (dto.ministryRoleId) {
      await this.ensureRoleBelongsToMinistry(dto.ministryId, dto.ministryRoleId);
    }

    await this.prisma.memberMinistry.upsert({
      where: {
        memberId_ministryId: {
          memberId,
          ministryId: dto.ministryId,
        },
      },
      update: {
        ministryRoleId: dto.ministryRoleId ?? null,
        startedAt: parseOptionalDate(dto.startedAt) ?? new Date(),
        endedAt: null,
      },
      create: {
        memberId,
        ministryId: dto.ministryId,
        ministryRoleId: dto.ministryRoleId,
        startedAt: parseOptionalDate(dto.startedAt) ?? new Date(),
      },
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
