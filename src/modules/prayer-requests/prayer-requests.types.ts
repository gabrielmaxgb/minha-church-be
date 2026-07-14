import type { Member, PrayerRequest } from '@prisma/client';

export interface PrayerRequestAuthorSummary {
  id: string;
  name: string;
}

export interface PrayerRequestResponse {
  id: string;
  churchId: string;
  body: string;
  isAnonymous: boolean;
  author: PrayerRequestAuthorSummary | null;
  prayerCount: number;
  prayedByMe: boolean;
  canDelete: boolean;
  canArchive: boolean;
  isArchived: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

type PrayerRequestWithAuthor = PrayerRequest & {
  author: Pick<Member, 'id' | 'name'>;
  _count: { prayers: number };
  prayers?: { memberId: string }[];
};

export function toPrayerRequestResponse(
  request: PrayerRequestWithAuthor,
  options: { viewerMemberId: string | null; canModerate: boolean },
): PrayerRequestResponse {
  const isAuthor =
    options.viewerMemberId !== null &&
    request.authorMemberId === options.viewerMemberId;

  const showAuthor = !request.isAnonymous || isAuthor || options.canModerate;
  const isArchived = request.archivedAt !== null;

  return {
    id: request.id,
    churchId: request.churchId,
    body: request.body,
    isAnonymous: request.isAnonymous,
    author: showAuthor
      ? {
          id: request.author.id,
          name: request.author.name,
        }
      : null,
    prayerCount: request._count.prayers,
    prayedByMe: Boolean(
      options.viewerMemberId &&
        request.prayers?.some((p) => p.memberId === options.viewerMemberId),
    ),
    canDelete: isAuthor || options.canModerate,
    canArchive: (isAuthor || options.canModerate) && !isArchived,
    isArchived,
    archivedAt: request.archivedAt?.toISOString() ?? null,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
  };
}
