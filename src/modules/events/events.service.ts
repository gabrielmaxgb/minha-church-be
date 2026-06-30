import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  CHURCH_EVENT_MANAGER_ROLES,
} from '../../common/guards';
import { ChurchPermissionsService } from '../../common/services/church-permissions.service';
import { PrismaService } from '../../database/prisma.service';
import { UsersService } from '../users/users.service';
import {
  toMinistryEventResponse,
  type MinistryEventResponse,
} from '../ministries/ministries.types';
import {
  CreateChurchEventDto,
  ListChurchEventsQueryDto,
} from './dto/event.dto';

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly churchPermissions: ChurchPermissionsService,
  ) {}

  async findAll(
    churchId: string,
    query: ListChurchEventsQueryDto,
  ): Promise<MinistryEventResponse[]> {
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
      },
      include: { ministry: true },
      orderBy: { startsAt: 'asc' },
    });

    return events.map(toMinistryEventResponse);
  }

  async create(
    churchId: string,
    userId: string,
    dto: CreateChurchEventDto,
  ): Promise<MinistryEventResponse> {
    if (dto.ministryId) {
      await this.assertCanManageMinistryEvent(
        userId,
        churchId,
        dto.ministryId,
      );
    } else {
      await this.assertCanManageChurchEvents(userId, churchId);
    }

    const event = await this.prisma.ministryEvent.create({
      data: {
        churchId,
        ministryId: dto.ministryId ?? null,
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

  private async assertCanManageChurchEvents(userId: string, churchId: string) {
    const churchRole = await this.usersService.getRoleInChurch(userId, churchId);

    if (!this.churchPermissions.isChurchRole(churchRole, CHURCH_EVENT_MANAGER_ROLES)) {
      throw new ForbiddenException(
        'Sem permissão para criar atividades da igreja.',
      );
    }
  }

  private async assertCanManageMinistryEvent(
    userId: string,
    churchId: string,
    ministryId: string,
  ) {
    const ministry = await this.prisma.ministry.findFirst({
      where: { id: ministryId, churchId, isActive: true },
    });

    if (!ministry) {
      throw new NotFoundException('Ministério não encontrado.');
    }

    const churchRole = await this.usersService.getRoleInChurch(userId, churchId);
    const allowed = await this.churchPermissions.canManageMinistryEvents(
      userId,
      churchId,
      ministryId,
      churchRole,
    );

    if (!allowed) {
      throw new ForbiddenException(
        'Sem permissão para criar atividades deste ministério.',
      );
    }
  }
}
