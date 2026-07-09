import type { SubscriptionStatus } from '@prisma/client';

export interface ChurchRecord {
  id: string;
  name: string;
  slug: string;
  memberCount: number;
  subscriptionStatus: SubscriptionStatus;
  trialEndsAt: Date | null;
}
