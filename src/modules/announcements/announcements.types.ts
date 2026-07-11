import type {
  AnnouncementAudienceType,
  AnnouncementPriority,
} from '@prisma/client';

export type AnnouncementStatus = 'scheduled' | 'published' | 'expired';

export interface AnnouncementMinistryTarget {
  id: string;
  name: string;
}

export interface AnnouncementResponse {
  id: string;
  churchId: string;
  title: string;
  body: string;
  priority: AnnouncementPriority;
  audienceType: AnnouncementAudienceType;
  ministries: AnnouncementMinistryTarget[];
  pinned: boolean;
  status: AnnouncementStatus;
  publishedAt: string | null;
  expiresAt: string | null;
  createdByUserId: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  /** Presente apenas no feed do usuário. */
  isRead?: boolean;
  /** Presente apenas na visão de gestão. */
  readCount?: number;
}

export function resolveAnnouncementStatus(
  publishedAt: Date | null,
  expiresAt: Date | null,
  now: Date = new Date(),
): AnnouncementStatus {
  if (expiresAt && expiresAt.getTime() <= now.getTime()) {
    return 'expired';
  }

  if (!publishedAt || publishedAt.getTime() > now.getTime()) {
    return 'scheduled';
  }

  return 'published';
}
