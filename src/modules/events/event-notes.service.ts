import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ChurchPermission,
  EventNoteVisibility,
  type Prisma,
} from '@prisma/client';

import { ChurchPermissionsService } from '../../common/services/church-permissions.service';
import { PrismaService } from '../../database/prisma.service';
import {
  buildEventViewContext,
  canUserViewEventWithContext,
} from './event-visibility';
import type {
  CreateEventNoteDto,
  UpdateEventNoteDto,
} from './dto/event-note.dto';

const noteInclude = {
  author: { select: { id: true, name: true } },
  roles: {
    include: {
      role: { select: { id: true, name: true, color: true } },
    },
  },
} as const;

type NoteWithRelations = Prisma.EventNoteGetPayload<{
  include: typeof noteInclude;
}>;

export interface EventNoteRoleOption {
  id: string;
  name: string;
  color: string | null;
}

export interface EventNoteResult {
  id: string;
  eventId: string;
  body: string;
  visibility: EventNoteVisibility;
  authorUserId: string;
  authorName: string;
  roles: EventNoteRoleOption[];
  canEdit: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EventNotesListResult {
  notes: EventNoteResult[];
  canCreate: boolean;
  roleOptions: EventNoteRoleOption[];
}

@Injectable()
export class EventNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly churchPermissions: ChurchPermissionsService,
  ) {}

  async list(
    churchId: string,
    eventId: string,
    userId: string,
  ): Promise<EventNotesListResult> {
    const event = await this.requireVisibleEvent(churchId, eventId, userId);
    const access = await this.churchPermissions.getMembershipAccess(
      userId,
      churchId,
    );
    const canManage = await this.canManageEvent(userId, churchId, event);
    const userRoleIds = new Set(access?.roles.map((role) => role.id) ?? []);
    const isOwner = Boolean(access?.isOwner);

    const notes = await this.prisma.eventNote.findMany({
      where: { churchId, eventId, deletedAt: null },
      include: noteInclude,
      orderBy: { createdAt: 'desc' },
    });

    const visible = notes.filter((note) =>
      this.canReadNote(note, {
        userId,
        isOwner,
        canManage,
        userRoleIds,
      }),
    );

    const needsRoleOptions =
      canManage ||
      isOwner ||
      visible.some((note) => note.authorUserId === userId);

    return {
      notes: visible.map((note) =>
        this.toResult(note, {
          userId,
          isOwner,
          canManage,
        }),
      ),
      canCreate: canManage,
      roleOptions: needsRoleOptions ? await this.listRoleOptions(churchId) : [],
    };
  }

  async create(
    churchId: string,
    eventId: string,
    userId: string,
    dto: CreateEventNoteDto,
  ): Promise<EventNoteResult> {
    const event = await this.requireVisibleEvent(churchId, eventId, userId);
    await this.assertCanManageEvent(userId, churchId, event);

    const roleIds = await this.resolveRoleIdsForWrite(
      churchId,
      dto.visibility,
      dto.roleIds,
    );

    const note = await this.prisma.eventNote.create({
      data: {
        churchId,
        eventId,
        authorUserId: userId,
        body: dto.body.trim(),
        visibility: dto.visibility,
        roles:
          roleIds.length > 0
            ? { create: roleIds.map((roleId) => ({ roleId })) }
            : undefined,
      },
      include: noteInclude,
    });

    return this.toResult(note, {
      userId,
      isOwner: true,
      canManage: true,
    });
  }

  async update(
    churchId: string,
    eventId: string,
    noteId: string,
    userId: string,
    dto: UpdateEventNoteDto,
  ): Promise<EventNoteResult> {
    const event = await this.requireVisibleEvent(churchId, eventId, userId);
    const existing = await this.getNoteOrThrow(churchId, eventId, noteId);
    const access = await this.churchPermissions.getMembershipAccess(
      userId,
      churchId,
    );
    const canManage = await this.canManageEvent(userId, churchId, event);
    const isOwner = Boolean(access?.isOwner);

    if (
      !this.canEditNote(existing, { userId, isOwner, canManage })
    ) {
      throw new ForbiddenException('Sem permissão para editar esta nota.');
    }

    const nextVisibility = dto.visibility ?? existing.visibility;
    const roleIds =
      dto.visibility !== undefined || dto.roleIds !== undefined
        ? await this.resolveRoleIdsForWrite(
            churchId,
            nextVisibility,
            dto.roleIds ??
              existing.roles.map((link) => link.roleId),
          )
        : null;

    const note = await this.prisma.$transaction(async (tx) => {
      if (roleIds) {
        await tx.eventNoteRole.deleteMany({ where: { noteId: existing.id } });
        if (roleIds.length > 0) {
          await tx.eventNoteRole.createMany({
            data: roleIds.map((roleId) => ({
              noteId: existing.id,
              roleId,
            })),
          });
        }
      }

      return tx.eventNote.update({
        where: { id: existing.id },
        data: {
          ...(dto.body !== undefined ? { body: dto.body.trim() } : {}),
          ...(dto.visibility !== undefined
            ? { visibility: dto.visibility }
            : {}),
        },
        include: noteInclude,
      });
    });

    return this.toResult(note, { userId, isOwner, canManage });
  }

  async remove(
    churchId: string,
    eventId: string,
    noteId: string,
    userId: string,
  ): Promise<void> {
    const event = await this.requireVisibleEvent(churchId, eventId, userId);
    const existing = await this.getNoteOrThrow(churchId, eventId, noteId);
    const access = await this.churchPermissions.getMembershipAccess(
      userId,
      churchId,
    );
    const canManage = await this.canManageEvent(userId, churchId, event);
    const isOwner = Boolean(access?.isOwner);

    if (!this.canEditNote(existing, { userId, isOwner, canManage })) {
      throw new ForbiddenException('Sem permissão para excluir esta nota.');
    }

    await this.prisma.eventNote.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    });
  }

  private async requireVisibleEvent(
    churchId: string,
    eventId: string,
    userId: string,
  ) {
    const event = await this.prisma.ministryEvent.findFirst({
      where: { id: eventId, churchId, deletedAt: null },
      include: { ministry: { select: { isActive: true } } },
    });

    if (!event) {
      throw new NotFoundException('Evento não encontrado.');
    }

    const viewContext = await buildEventViewContext(
      this.prisma,
      this.churchPermissions,
      userId,
      churchId,
    );

    if (!canUserViewEventWithContext(event, viewContext)) {
      throw new NotFoundException('Evento não encontrado.');
    }

    return event;
  }

  private async getNoteOrThrow(
    churchId: string,
    eventId: string,
    noteId: string,
  ) {
    const note = await this.prisma.eventNote.findFirst({
      where: { id: noteId, churchId, eventId, deletedAt: null },
      include: noteInclude,
    });

    if (!note) {
      throw new NotFoundException('Nota não encontrada.');
    }

    return note;
  }

  private async listRoleOptions(
    churchId: string,
  ): Promise<EventNoteRoleOption[]> {
    const roles = await this.prisma.churchRole.findMany({
      where: { churchId },
      select: { id: true, name: true, color: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    return roles;
  }

  private async resolveRoleIdsForWrite(
    churchId: string,
    visibility: EventNoteVisibility,
    roleIds: string[] | undefined,
  ): Promise<string[]> {
    if (visibility === EventNoteVisibility.public) {
      return [];
    }

    const unique = [...new Set((roleIds ?? []).map((id) => id.trim()).filter(Boolean))];
    if (unique.length === 0) {
      throw new BadRequestException(
        'Escolha ao menos um cargo que pode ver a nota privada.',
      );
    }

    const roles = await this.prisma.churchRole.findMany({
      where: { churchId, id: { in: unique } },
      select: { id: true },
    });

    if (roles.length !== unique.length) {
      throw new BadRequestException('Um ou mais cargos são inválidos.');
    }

    return unique;
  }

  private canReadNote(
    note: NoteWithRelations,
    ctx: {
      userId: string;
      isOwner: boolean;
      canManage: boolean;
      userRoleIds: Set<string>;
    },
  ): boolean {
    if (note.visibility === EventNoteVisibility.public) {
      return true;
    }

    if (
      ctx.isOwner ||
      ctx.canManage ||
      note.authorUserId === ctx.userId
    ) {
      return true;
    }

    return note.roles.some((link) => ctx.userRoleIds.has(link.roleId));
  }

  private canEditNote(
    note: NoteWithRelations,
    ctx: { userId: string; isOwner: boolean; canManage: boolean },
  ): boolean {
    return (
      ctx.isOwner ||
      ctx.canManage ||
      note.authorUserId === ctx.userId
    );
  }

  private async canManageEvent(
    userId: string,
    churchId: string,
    event: { ministryId: string | null; createdByUserId: string | null },
  ): Promise<boolean> {
    try {
      await this.assertCanManageEvent(userId, churchId, event);
      return true;
    } catch {
      return false;
    }
  }

  private async assertCanManageEvent(
    userId: string,
    churchId: string,
    event: { ministryId: string | null; createdByUserId: string | null },
  ): Promise<void> {
    if (event.ministryId) {
      const ministry = await this.prisma.ministry.findFirst({
        where: { id: event.ministryId, churchId },
        select: { isActive: true },
      });

      if (!ministry) {
        throw new NotFoundException('Ministério não encontrado.');
      }

      if (!ministry.isActive) {
        throw new ForbiddenException(
          'Este ministério está inativo. Reative-o para gerenciar notas do evento.',
        );
      }

      const allowed = await this.churchPermissions.canManageMinistryEvents(
        userId,
        churchId,
        event.ministryId,
      );

      if (!allowed) {
        throw new ForbiddenException(
          'Sem permissão para gerenciar notas deste evento.',
        );
      }

      return;
    }

    if (event.createdByUserId === userId) {
      return;
    }

    const allowed = await this.churchPermissions.hasPermission(
      userId,
      churchId,
      ChurchPermission.events_create_church_wide,
    );

    if (!allowed) {
      throw new ForbiddenException(
        'Sem permissão para gerenciar notas deste evento.',
      );
    }
  }

  private toResult(
    note: NoteWithRelations,
    ctx: { userId: string; isOwner: boolean; canManage: boolean },
  ): EventNoteResult {
    return {
      id: note.id,
      eventId: note.eventId,
      body: note.body,
      visibility: note.visibility,
      authorUserId: note.authorUserId,
      authorName: note.author.name,
      roles: note.roles.map((link) => ({
        id: link.role.id,
        name: link.role.name,
        color: link.role.color,
      })),
      canEdit: this.canEditNote(note, ctx),
      createdAt: note.createdAt.toISOString(),
      updatedAt: note.updatedAt.toISOString(),
    };
  }
}
