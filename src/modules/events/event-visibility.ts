import { ChurchPermission, type Prisma } from '@prisma/client';

import type { MembershipAccessContext } from '../../common/services/church-permissions.service';
import { ChurchPermissionsService } from '../../common/services/church-permissions.service';
import { PrismaService } from '../../database/prisma.service';

export function canBypassEventVisibility(
  access: MembershipAccessContext,
): boolean {
  if (access.isOwner) {
    return true;
  }

  return (
    access.permissions.has(ChurchPermission.ministries_manage) ||
    access.permissions.has(ChurchPermission.events_create_church_wide)
  );
}

export async function buildVisibleEventsWhere(
  prisma: PrismaService,
  churchPermissions: ChurchPermissionsService,
  userId: string,
  churchId: string,
): Promise<Prisma.MinistryEventWhereInput | undefined> {
  const access = await churchPermissions.getMembershipAccess(userId, churchId);

  if (!access || canBypassEventVisibility(access)) {
    return undefined;
  }

  const member = await prisma.member.findFirst({
    where: { churchId, userId, deletedAt: null },
    include: {
      ministryLinks: {
        where: { endedAt: null },
        select: { ministryId: true },
      },
    },
  });

  const ministryIds = member?.ministryLinks.map((link) => link.ministryId) ?? [];

  return {
    OR: [
      { ministryId: null },
      { visibleToChurch: true },
      ...(ministryIds.length > 0
        ? [{ ministryId: { in: ministryIds } }]
        : []),
    ],
  };
}

export interface EventViewContext {
  canBypass: boolean;
  memberMinistryIds: Set<string>;
  hasMembership: boolean;
}

export async function buildEventViewContext(
  prisma: PrismaService,
  churchPermissions: ChurchPermissionsService,
  userId: string,
  churchId: string,
): Promise<EventViewContext> {
  const access = await churchPermissions.getMembershipAccess(userId, churchId);

  if (!access) {
    return {
      canBypass: false,
      memberMinistryIds: new Set(),
      hasMembership: false,
    };
  }

  if (canBypassEventVisibility(access)) {
    return {
      canBypass: true,
      memberMinistryIds: new Set(),
      hasMembership: true,
    };
  }

  const member = await prisma.member.findFirst({
    where: { churchId, userId, deletedAt: null },
    include: {
      ministryLinks: {
        where: { endedAt: null },
        select: { ministryId: true },
      },
    },
  });

  return {
    canBypass: false,
    memberMinistryIds: new Set(
      member?.ministryLinks.map((link) => link.ministryId) ?? [],
    ),
    hasMembership: true,
  };
}

export function canUserViewEventWithContext(
  event: {
    ministryId: string | null;
    visibleToChurch: boolean;
  },
  context: EventViewContext,
): boolean {
  if (!context.hasMembership) {
    return false;
  }

  if (!event.ministryId || event.visibleToChurch) {
    return true;
  }

  if (context.canBypass) {
    return true;
  }

  return context.memberMinistryIds.has(event.ministryId);
}

export async function canUserViewEvent(
  prisma: PrismaService,
  churchPermissions: ChurchPermissionsService,
  userId: string,
  churchId: string,
  event: {
    ministryId: string | null;
    visibleToChurch: boolean;
  },
): Promise<boolean> {
  const context = await buildEventViewContext(
    prisma,
    churchPermissions,
    userId,
    churchId,
  );

  return canUserViewEventWithContext(event, context);
}
