import { NotificationType } from '@prisma/client';

export interface NotificationInboxItem {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  href: string | null;
  entityType: string | null;
  entityId: string | null;
  payload: unknown;
  createdAt: string;
  expiresAt: string | null;
  read: boolean;
}

export interface NotificationInboxResponse {
  items: NotificationInboxItem[];
  unreadCount: number;
}
