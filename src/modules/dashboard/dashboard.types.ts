import type { MinistryEventResponse } from '../ministries/ministries.types';

export interface DashboardSummaryResponse {
  memberCount: number;
  activeMembers: number;
  upcomingEvents: number;
  monthlyBalance: number;
  featuredEvents: MinistryEventResponse[];
}
