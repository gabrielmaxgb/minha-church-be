import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import type { AuditAction } from '../audit/audit.constants';
import { compactMetadata } from '../audit/audit.helpers';
import {
  getAuditRetentionDays,
  getRetentionCutoff,
} from '../audit/audit-retention';

export interface AuditLogInput {
  churchId: string;
  actorUserId?: string | null;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  summary: string;
  metadata?: Record<string, unknown>;
}

export interface AuditLogItem {
  id: string;
  churchId: string;
  action: string;
  targetType?: string;
  targetId?: string;
  summary: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  actor?: {
    id: string;
    name: string;
    email: string;
  };
}

export interface AuditLogPage {
  items: AuditLogItem[];
  nextCursor: string | null;
  retentionDays: number;
}

const PURGE_INTERVAL_MS = 60 * 60 * 1000;
const PURGE_BATCH_SIZE = 500;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 50;

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  private readonly lastPurgeAt = new Map<string, number>();

  constructor(private readonly prisma: PrismaService) {}

  async log(input: AuditLogInput): Promise<void> {
    const metadata = compactMetadata(input.metadata);

    try {
      await this.prisma.auditLog.create({
        data: {
          churchId: input.churchId,
          actorUserId: input.actorUserId ?? null,
          action: input.action,
          targetType: input.targetType,
          targetId: input.targetId,
          summary: input.summary.slice(0, 280),
          ...(metadata ? { metadata: metadata as Prisma.InputJsonValue } : {}),
        },
      });

      void this.maybePurgeExpired(input.churchId);
    } catch (error) {
      this.logger.error(
        `Failed to write audit log (${input.action}) for church ${input.churchId}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  async findPage(
    churchId: string,
    options: {
      cursor?: string;
      limit?: number;
      action?: string;
    } = {},
  ): Promise<AuditLogPage> {
    const church = await this.prisma.church.findUnique({
      where: { id: churchId },
      select: { planTier: true, memberCount: true },
    });

    if (!church) {
      throw new NotFoundException('Igreja não encontrada.');
    }

    await this.maybePurgeExpired(churchId);

    const retentionDays = getAuditRetentionDays(
      church.planTier,
      church.memberCount,
    );
    const cutoff = getRetentionCutoff(church.planTier, church.memberCount);
    const limit = Math.min(
      Math.max(options.limit ?? DEFAULT_PAGE_SIZE, 1),
      MAX_PAGE_SIZE,
    );

    const cursor = decodeCursor(options.cursor);

    const rows = await this.prisma.auditLog.findMany({
      where: {
        churchId,
        createdAt: { gte: cutoff },
        ...(options.action ? { action: options.action } : {}),
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                {
                  createdAt: cursor.createdAt,
                  id: { lt: cursor.id },
                },
              ],
            }
          : {}),
      },
      include: {
        actor: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const last = pageRows.at(-1);

    return {
      items: pageRows.map((row) => ({
        id: row.id,
        churchId: row.churchId,
        action: row.action,
        targetType: row.targetType ?? undefined,
        targetId: row.targetId ?? undefined,
        summary: row.summary,
        metadata:
          row.metadata && typeof row.metadata === 'object'
            ? (row.metadata as Record<string, unknown>)
            : undefined,
        createdAt: row.createdAt.toISOString(),
        actor: row.actor
          ? {
              id: row.actor.id,
              name: row.actor.name,
              email: row.actor.email,
            }
          : undefined,
      })),
      nextCursor:
        hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
      retentionDays,
    };
  }

  private async maybePurgeExpired(churchId: string): Promise<void> {
    const now = Date.now();
    const last = this.lastPurgeAt.get(churchId) ?? 0;

    if (now - last < PURGE_INTERVAL_MS) {
      return;
    }

    this.lastPurgeAt.set(churchId, now);

    try {
      await this.purgeExpired(churchId);
    } catch (error) {
      this.logger.warn(
        `Audit purge failed for church ${churchId}`,
        error instanceof Error ? error.message : undefined,
      );
    }
  }

  private async purgeExpired(churchId: string): Promise<void> {
    const church = await this.prisma.church.findUnique({
      where: { id: churchId },
      select: { planTier: true, memberCount: true },
    });

    if (!church) {
      return;
    }

    const cutoff = getRetentionCutoff(church.planTier, church.memberCount);

    for (let batch = 0; batch < 5; batch += 1) {
      const stale = await this.prisma.auditLog.findMany({
        where: {
          churchId,
          createdAt: { lt: cutoff },
        },
        select: { id: true },
        take: PURGE_BATCH_SIZE,
      });

      if (stale.length === 0) {
        return;
      }

      await this.prisma.auditLog.deleteMany({
        where: {
          id: { in: stale.map((row) => row.id) },
        },
      });

      if (stale.length < PURGE_BATCH_SIZE) {
        return;
      }
    }
  }
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');
}

function decodeCursor(
  cursor: string | undefined,
): { createdAt: Date; id: string } | null {
  if (!cursor) {
    return null;
  }

  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const separatorIndex = decoded.indexOf('|');

    if (separatorIndex === -1) {
      return null;
    }

    const createdAt = new Date(decoded.slice(0, separatorIndex));
    const id = decoded.slice(separatorIndex + 1);

    if (Number.isNaN(createdAt.getTime()) || !id) {
      return null;
    }

    return { createdAt, id };
  } catch {
    return null;
  }
}
