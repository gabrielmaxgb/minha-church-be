import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { ChurchPermissionsService } from '../../common/services/church-permissions.service';
import { PrismaService } from '../../database/prisma.service';
import { UsersService } from '../users/users.service';
import {
  CreateMinistryDto,
  CreateMinistryEventDto,
  CreateMinistryRoleDto,
  ListMinistryEventsQueryDto,
  UpdateMinistryDto,
  UpdateMinistryEventDto,
  UpdateMinistryRoleDto,
} from './dto/ministry.dto';
import {
  toMinistryEventResponse,
  toMinistryResponse,
  toMinistryRoleResponse,
  type MinistryEventResponse,
  type MinistryMemberResponse,
  type MinistryResponse,
  type MinistryRoleResponse,
} from './ministries.types';

@Injectable()
export class MinistriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly churchPermissions: ChurchPermissionsService,
  ) {}

  async findAll(churchId: string): Promise<MinistryResponse[]> {
    const ministries = await this.prisma.ministry.findMany({
      where: { churchId },
      include: { roles: true },
      orderBy: { name: 'asc' },
    });

    return ministries.map(toMinistryResponse);
  }

  async findOne(churchId: string, ministryId: string): Promise<MinistryResponse> {
    const ministry = await this.getMinistryOrThrow(churchId, ministryId);

    return toMinistryResponse(ministry);
  }

  async create(churchId: string, dto: CreateMinistryDto): Promise<MinistryResponse> {
    await this.ensureMinistryNameAvailable(churchId, dto.name);

    const ministry = await this.prisma.ministry.create({
      data: {
        churchId,
        name: dto.name.trim(),
        description: dto.description,
      },
      include: { roles: true },
    });

    return toMinistryResponse(ministry);
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
        ...(dto.description !== undefined ? { description: dto.description } : {}),
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
        ministryRole: true,
      },
      orderBy: { member: { name: 'asc' } },
    });

    return links.map((link) => ({
      id: link.id,
      memberId: link.memberId,
      memberName: link.member.name,
      memberEmail: link.member.email,
      memberPhone: link.member.phone,
      ministryRoleId: link.ministryRoleId,
      ministryRoleName: link.ministryRole?.name ?? null,
      startedAt: link.startedAt?.toISOString() ?? null,
    }));
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
        ...(query.to ? { startsAt: { lte: new Date(`${query.to}T23:59:59.999Z`) } } : {}),
      },
      include: { ministry: true },
      orderBy: { startsAt: 'asc' },
    });

    return events.map(toMinistryEventResponse);
  }

  async createEvent(
    churchId: string,
    ministryId: string,
    userId: string,
    dto: CreateMinistryEventDto,
  ): Promise<MinistryEventResponse> {
    await this.getMinistryOrThrow(churchId, ministryId);
    await this.assertCanManageEvents(userId, churchId, ministryId);

    const event = await this.prisma.ministryEvent.create({
      data: {
        churchId,
        ministryId,
        name: dto.name.trim(),
        description: dto.description,
        location: dto.location,
        startsAt: new Date(dto.startsAt),
        endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
        createdByUserId: userId,
      },
      include: { ministry: true },
    });

    return toMinistryEventResponse(event);
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

    const event = await this.prisma.ministryEvent.update({
      where: { id: eventId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.location !== undefined ? { location: dto.location } : {}),
        ...(dto.startsAt !== undefined ? { startsAt: new Date(dto.startsAt) } : {}),
        ...(dto.endsAt !== undefined
          ? { endsAt: dto.endsAt ? new Date(dto.endsAt) : null }
          : {}),
      },
      include: { ministry: true },
    });

    return toMinistryEventResponse(event);
  }

  async removeEvent(
    churchId: string,
    ministryId: string,
    eventId: string,
    userId: string,
  ): Promise<void> {
    await this.getMinistryOrThrow(churchId, ministryId);
    await this.assertCanManageEvents(userId, churchId, ministryId);
    await this.getEventOrThrow(churchId, ministryId, eventId);

    await this.prisma.ministryEvent.update({
      where: { id: eventId },
      data: { deletedAt: new Date() },
    });
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
      throw new ConflictException('Já existe um cargo com este nome no ministério.');
    }
  }
}
