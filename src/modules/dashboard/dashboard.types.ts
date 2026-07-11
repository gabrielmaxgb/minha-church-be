import type { MinistryEventResponse } from '../ministries/ministries.types';

export interface DashboardSummaryResponse {
  memberCount: number | null;
  activeMembers: number | null;
  upcomingEvents: number | null;
  monthlyBalance: number | null;
  featuredEvents: MinistryEventResponse[];
}
