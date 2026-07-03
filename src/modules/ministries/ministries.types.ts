import type {
  EventRecurrenceSeries,
  Ministry,
  MinistryEvent,
  MinistryRole,
} from '@prisma/client';

import type { EventRecurrenceResponse } from '../events/event-recurrence.types';

export interface MinistryRoleResponse {
  id: string;
  ministryId: string;
  name: string;
  sortOrder: number;
  canManageEvents: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MinistryResponse {
  id: string;
  churchId: string;
  name: string;
  description: string | null;
  isActive: boolean;
  roles: MinistryRoleResponse[];
  createdAt: string;
  updatedAt: string;
}

export interface MinistryEventResponse {
  id: string;
  churchId: string;
  ministryId: string | null;
  ministryName: string | null;
  isChurchWide: boolean;
  name: string;
  description: string | null;
  location: string | null;
  startsAt: string;
  endsAt: string | null;
  createdByUserId: string | null;
  recurrenceSeriesId: string | null;
  recurrence: EventRecurrenceResponse | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMinistryEventResponse extends MinistryEventResponse {
  occurrencesCreated: number;
}

export interface MinistryMemberResponse {
  id: string;
  memberId: string;
  memberName: string;
  memberEmail: string | null;
  memberPhone: string | null;
  roles: Array<{
    id: string;
    name: string;
    canManageEvents: boolean;
  }>;
  canManageEvents: boolean;
  startedAt: string | null;
}

export function toMinistryRoleResponse(role: MinistryRole): MinistryRoleResponse {
  return {
    id: role.id,
    ministryId: role.ministryId,
    name: role.name,
    sortOrder: role.sortOrder,
    canManageEvents: role.canManageEvents,
    createdAt: role.createdAt.toISOString(),
    updatedAt: role.updatedAt.toISOString(),
  };
}

export function toMinistryResponse(
  ministry: Ministry & { roles: MinistryRole[] },
): MinistryResponse {
  return {
    id: ministry.id,
    churchId: ministry.churchId,
    name: ministry.name,
    description: ministry.description,
    isActive: ministry.isActive,
    roles: ministry.roles
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(toMinistryRoleResponse),
    createdAt: ministry.createdAt.toISOString(),
    updatedAt: ministry.updatedAt.toISOString(),
  };
}

export function toEventRecurrenceResponse(
  series: EventRecurrenceSeries,
): EventRecurrenceResponse {
  return {
    seriesId: series.id,
    frequency: series.frequency,
    interval: series.interval,
    daysOfWeek: series.daysOfWeek,
    endDate: series.endDate
      ? series.endDate.toISOString().slice(0, 10)
      : null,
    maxOccurrences: series.maxOccurrences,
  };
}

export function toMinistryEventResponse(
  event: MinistryEvent & {
    ministry: Ministry | null;
    recurrenceSeries?: EventRecurrenceSeries | null;
  },
): MinistryEventResponse {
  return {
    id: event.id,
    churchId: event.churchId,
    ministryId: event.ministryId,
    ministryName: event.ministry?.name ?? null,
    isChurchWide: event.ministryId === null,
    name: event.name,
    description: event.description,
    location: event.location,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt?.toISOString() ?? null,
    createdByUserId: event.createdByUserId,
    recurrenceSeriesId: event.recurrenceSeriesId,
    recurrence: event.recurrenceSeries
      ? toEventRecurrenceResponse(event.recurrenceSeries)
      : null,
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
  };
}
