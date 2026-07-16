import type { SubscriptionStatus } from '@prisma/client';

export interface ChurchRecord {
  id: string;
  name: string;
  slug: string;
  memberCount: number;
  subscriptionStatus: SubscriptionStatus;
  trialEndsAt: Date | null;
  pastDueSince: Date | null;
  dpaAcceptedAt: Date | null;
  dpaVersion: string | null;
  deletedAt: Date | null;
  purgeAfter: Date | null;
}

export interface RegisterChurchInput {
  churchName: string;
  ownerName: string;
  ownerEmail: string;
  passwordHash: string;
}

export interface RegisterChurchResult {
  churchId: string;
  userId: string;
}
