import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ChurchPermission,
  MemberStatus,
  PastoralNoteType,
  Prisma,
} from '@prisma/client';

import { ChurchPermissionsService } from '../../common/services/church-permissions.service';
import { PrismaService } from '../../database/prisma.service';
import {
  CreatePastoralNoteDto,
  UpdatePastoralNoteDto,
} from './dto/pastoral-note.dto';
import type {
  PastoralCareSummaryMember,
  PastoralCareSummaryResult,
  PastoralNoteListResult,
  PastoralNoteResult,
} from './pastoral-notes.types';

const WITHOUT_CONTACT_DAYS = 60;
/** Janela à frente para retornos na lista de acompanhamento. */
const FOLLOW_UP_HORIZON_DAYS = 7;
const BODY_MAX = 4000;

function emptyToNull(value?: string | null): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function parseDateOnly(value: string, label = 'Data'): Date {
  const dateOnly = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
    throw new BadRequestException(`${label} inválida.`);
  }
  const [y, m, d] = dateOnly.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() + 1 !== m ||
    date.getUTCDate() !== d
  ) {
    throw new BadRequestException(`${label} inválida.`);
  }
  return date;
}

/** Chave `YYYY-MM-DD` a partir de coluna `@db.Date` (sempre via UTC). */
function toDateKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Hoje no fuso da igreja (Brasil). */
function todayKeySaoPaulo(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return toDateKey(next);
}

function daysBetweenKeys(fromKey: string, toKey: string): number {
  const [fy, fm, fd] = fromKey.split('-').map(Number);
  const [ty, tm, td] = toKey.split('-').map(Number);
  const a = Date.UTC(fy, fm - 1, fd);
  const b = Date.UTC(ty, tm - 1, td);
  return Math.floor((b - a) / 86_400_000);
}

@Injectable()
export class PastoralNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly churchPermissions: ChurchPermissionsService,
  ) {}

  private async requirePastoralCare(
    churchId: string,
    userId: string,
  ): Promise<void> {
    const allowed = await this.churchPermissions.hasPermission(
      userId,
      churchId,
      ChurchPermission.pastoral_care,
    );
    if (!allowed) {
      throw new ForbiddenException(
        'Você não tem permissão para o acompanhamento da igreja.',
      );
    }
  }

  private async assertActiveMember(
    churchId: string,
    memberId: string,
  ): Promise<{ id: string; name: string; status: MemberStatus }> {
    const member = await this.prisma.member.findFirst({
      where: { id: memberId, churchId, deletedAt: null },
      select: { id: true, name: true, status: true },
    });
    if (!member) {
      throw new NotFoundException('Pessoa não encontrada nesta igreja.');
    }
    return member;
  }

  private toResult(note: {
    id: string;
    memberId: string;
    type: PastoralNoteType;
    body: string;
    occurredOn: Date;
    followUpOn: Date | null;
    authorUserId: string;
    createdAt: Date;
    updatedAt: Date;
    member: { name: string; status: MemberStatus };
    author: { id: string; name: string };
  }): PastoralNoteResult {
    return {
      id: note.id,
      memberId: note.memberId,
      memberName: note.member.name,
      memberStatus: note.member.status,
      type: note.type,
      body: note.body,
      occurredOn: toDateKey(note.occurredOn),
      followUpOn: note.followUpOn ? toDateKey(note.followUpOn) : null,
      authorUserId: note.authorUserId,
      authorName: note.author.name,
      createdAt: note.createdAt.toISOString(),
      updatedAt: note.updatedAt.toISOString(),
    };
  }

  async listForMember(
    churchId: string,
    userId: string,
    memberId: string,
    options?: { page?: number; limit?: number },
  ): Promise<PastoralNoteListResult> {
    await this.requirePastoralCare(churchId, userId);
    await this.assertActiveMember(churchId, memberId);

    const page = Math.max(options?.page ?? 1, 1);
    const limit = Math.min(Math.max(options?.limit ?? 20, 1), 50);
    const where: Prisma.PastoralNoteWhereInput = {
      churchId,
      memberId,
      deletedAt: null,
    };

    const [total, notes] = await this.prisma.$transaction([
      this.prisma.pastoralNote.count({ where }),
      this.prisma.pastoralNote.findMany({
        where,
        include: {
          member: { select: { name: true, status: true } },
          author: { select: { id: true, name: true } },
        },
        orderBy: [{ occurredOn: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      items: notes.map((note) => this.toResult(note)),
      page,
      limit,
      total,
    };
  }

  async create(
    churchId: string,
    userId: string,
    dto: CreatePastoralNoteDto,
  ): Promise<PastoralNoteResult> {
    await this.requirePastoralCare(churchId, userId);
    await this.assertActiveMember(churchId, dto.memberId);

    const body = dto.body.trim();
    if (!body) {
      throw new BadRequestException('Escreva a anotação.');
    }
    if (body.length > BODY_MAX) {
      throw new BadRequestException('A anotação é longa demais.');
    }

    const occurredOn = parseDateOnly(dto.occurredOn);
    const followUpOn =
      dto.followUpOn === undefined || dto.followUpOn === null
        ? null
        : parseDateOnly(dto.followUpOn, 'Data de retorno');

    if (followUpOn && followUpOn < occurredOn) {
      throw new BadRequestException(
        'A data de retorno não pode ser anterior à data do registro.',
      );
    }

    const note = await this.prisma.pastoralNote.create({
      data: {
        churchId,
        memberId: dto.memberId,
        authorUserId: userId,
        type: dto.type,
        body,
        occurredOn,
        followUpOn,
      },
      include: {
        member: { select: { name: true, status: true } },
        author: { select: { id: true, name: true } },
      },
    });

    return this.toResult(note);
  }

  async update(
    churchId: string,
    userId: string,
    noteId: string,
    dto: UpdatePastoralNoteDto,
  ): Promise<PastoralNoteResult> {
    await this.requirePastoralCare(churchId, userId);

    const existing = await this.prisma.pastoralNote.findFirst({
      where: { id: noteId, churchId, deletedAt: null },
      select: {
        id: true,
        authorUserId: true,
        occurredOn: true,
        followUpOn: true,
      },
    });
    if (!existing) {
      throw new NotFoundException('Anotação não encontrada.');
    }

    const access = await this.churchPermissions.getMembershipAccess(
      userId,
      churchId,
    );
    if (existing.authorUserId !== userId && !access?.isOwner) {
      throw new ForbiddenException(
        'Só quem escreveu a anotação (ou o proprietário) pode editá-la.',
      );
    }

    const occurredOn =
      dto.occurredOn !== undefined
        ? parseDateOnly(dto.occurredOn)
        : existing.occurredOn;
    let followUpOn = existing.followUpOn;
    if (dto.followUpOn !== undefined) {
      followUpOn =
        dto.followUpOn === null
          ? null
          : parseDateOnly(dto.followUpOn, 'Data de retorno');
    }
    if (followUpOn && followUpOn < occurredOn) {
      throw new BadRequestException(
        'A data de retorno não pode ser anterior à data do registro.',
      );
    }

    const body =
      dto.body !== undefined ? dto.body.trim() : undefined;
    if (body !== undefined && !body) {
      throw new BadRequestException('Escreva a anotação.');
    }
    if (body !== undefined && body.length > BODY_MAX) {
      throw new BadRequestException('A anotação é longa demais.');
    }

    const note = await this.prisma.pastoralNote.update({
      where: { id: noteId },
      data: {
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(body !== undefined ? { body } : {}),
        ...(dto.occurredOn !== undefined ? { occurredOn } : {}),
        ...(dto.followUpOn !== undefined ? { followUpOn } : {}),
      },
      include: {
        member: { select: { name: true, status: true } },
        author: { select: { id: true, name: true } },
      },
    });

    return this.toResult(note);
  }

  async softDelete(
    churchId: string,
    userId: string,
    noteId: string,
  ): Promise<{ ok: true }> {
    await this.requirePastoralCare(churchId, userId);

    const existing = await this.prisma.pastoralNote.findFirst({
      where: { id: noteId, churchId, deletedAt: null },
      select: { id: true, authorUserId: true },
    });
    if (!existing) {
      throw new NotFoundException('Anotação não encontrada.');
    }

    const access = await this.churchPermissions.getMembershipAccess(
      userId,
      churchId,
    );
    if (existing.authorUserId !== userId && !access?.isOwner) {
      throw new ForbiddenException(
        'Só quem escreveu a anotação (ou o proprietário) pode excluí-la.',
      );
    }

    await this.prisma.pastoralNote.update({
      where: { id: noteId },
      data: { deletedAt: new Date() },
    });

    return { ok: true };
  }

  async getSummary(
    churchId: string,
    userId: string,
  ): Promise<PastoralCareSummaryResult> {
    await this.requirePastoralCare(churchId, userId);

    const todayKey = todayKeySaoPaulo();
    const cutoffKey = addDaysToDateKey(todayKey, -WITHOUT_CONTACT_DAYS);
    const followUpHorizonKey = addDaysToDateKey(
      todayKey,
      FOLLOW_UP_HORIZON_DAYS,
    );

    const [recentNotes, members] = await Promise.all([
      this.prisma.pastoralNote.findMany({
        where: { churchId, deletedAt: null },
        include: {
          member: { select: { name: true, status: true } },
          author: { select: { id: true, name: true } },
        },
        orderBy: [{ occurredOn: 'desc' }, { createdAt: 'desc' }],
        take: 8,
      }),
      this.prisma.member.findMany({
        where: {
          churchId,
          deletedAt: null,
          status: { in: [MemberStatus.active, MemberStatus.visitor] },
        },
        select: {
          id: true,
          name: true,
          status: true,
          pastoralNotes: {
            where: { deletedAt: null },
            orderBy: [{ occurredOn: 'desc' }, { createdAt: 'desc' }],
            take: 1,
            select: { occurredOn: true, followUpOn: true },
          },
        },
        take: 500,
      }),
    ]);

    /** Retornos: só a data de retorno da última anotação de cada pessoa. */
    const followUpsDue: PastoralCareSummaryMember[] = [];
    const withoutRecentContact: PastoralCareSummaryMember[] = [];

    for (const member of members) {
      const last = member.pastoralNotes[0];
      const lastOn = last?.occurredOn ?? null;
      const followUpOn = last?.followUpOn ?? null;
      const lastOnKey = lastOn ? toDateKey(lastOn) : null;
      const followUpKey = followUpOn ? toDateKey(followUpOn) : null;

      if (followUpKey && followUpKey <= followUpHorizonKey) {
        followUpsDue.push({
          memberId: member.id,
          memberName: member.name,
          memberStatus: member.status,
          lastNoteOn: lastOnKey,
          daysSinceLastNote: lastOnKey
            ? daysBetweenKeys(lastOnKey, todayKey)
            : null,
          openFollowUpOn: followUpKey,
        });
      }

      if (!lastOnKey || lastOnKey < cutoffKey) {
        withoutRecentContact.push({
          memberId: member.id,
          memberName: member.name,
          memberStatus: member.status,
          lastNoteOn: lastOnKey,
          daysSinceLastNote: lastOnKey
            ? daysBetweenKeys(lastOnKey, todayKey)
            : null,
          openFollowUpOn: followUpKey,
        });
      }
    }

    followUpsDue.sort((a, b) => {
      const aDate = a.openFollowUpOn ?? '';
      const bDate = b.openFollowUpOn ?? '';
      if (aDate !== bDate) return aDate.localeCompare(bDate);
      return a.memberName.localeCompare(b.memberName, 'pt-BR');
    });

    withoutRecentContact.sort((a, b) => {
      if (a.lastNoteOn === null && b.lastNoteOn === null) {
        return a.memberName.localeCompare(b.memberName, 'pt-BR');
      }
      if (a.lastNoteOn === null) return -1;
      if (b.lastNoteOn === null) return 1;
      return a.lastNoteOn.localeCompare(b.lastNoteOn);
    });

    return {
      followUpsDue: followUpsDue.slice(0, 30),
      withoutRecentContact: withoutRecentContact.slice(0, 30),
      recentNotes: recentNotes.map((note) => this.toResult(note)),
      thresholds: {
        withoutContactDays: WITHOUT_CONTACT_DAYS,
        followUpHorizonDays: FOLLOW_UP_HORIZON_DAYS,
      },
    };
  }
}
