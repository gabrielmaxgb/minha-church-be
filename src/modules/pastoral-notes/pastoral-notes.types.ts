export type PastoralNoteTypeValue =
  | 'visit'
  | 'conversation'
  | 'call'
  | 'follow_up'
  | 'other';

export interface PastoralNoteResult {
  id: string;
  memberId: string;
  memberName: string;
  memberStatus: string;
  type: PastoralNoteTypeValue;
  body: string;
  occurredOn: string;
  followUpOn: string | null;
  authorUserId: string;
  authorName: string;
  createdAt: string;
  updatedAt: string;
}

export interface PastoralNoteListResult {
  items: PastoralNoteResult[];
  page: number;
  limit: number;
  total: number;
}

export interface PastoralCareSummaryMember {
  memberId: string;
  memberName: string;
  memberStatus: string;
  lastNoteOn: string | null;
  daysSinceLastNote: number | null;
  openFollowUpOn: string | null;
}

export interface PastoralCareSummaryResult {
  followUpsDue: PastoralCareSummaryMember[];
  withoutRecentContact: PastoralCareSummaryMember[];
  recentNotes: PastoralNoteResult[];
  thresholds: {
    withoutContactDays: number;
  };
}
