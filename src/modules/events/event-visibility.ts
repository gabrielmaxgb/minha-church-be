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
  if (!event.ministryId || event.visibleToChurch) {
    return true;
  }

  const access = await churchPermissions.getMembershipAccess(userId, churchId);

  if (!access) {
    return false;
  }

  if (canBypassEventVisibility(access)) {
    return true;
  }

  const member = await prisma.member.findFirst({
    where: {
      churchId,
      userId,
      deletedAt: null,
      ministryLinks: {
        some: {
          ministryId: event.ministryId,
          endedAt: null,
        },
      },
    },
    select: { id: true },
  });

  return Boolean(member);
}
