import type {
  EventRecurrenceSeries,
  Ministry,
  MinistryEvent,
  MinistryRole,
} from '@prisma/client';

import type { EventRecurrenceResponse } from '../events/event-recurrence.types';
import { toEventRosterSlotResponse } from '../events/event-roster-slots';

export interface MinistryRoleResponse {
  id: string;
  ministryId: string;
  name: string;
  sortOrder: number;
  canManageEvents: boolean;
  canManageRoster: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RosterAvailabilityWindowResponse {
  active: boolean;
  periodType:
    'weekly' | 'monthly' | 'quarterly' | 'semiannual' | 'annual' | null;
  periodStart: string | null;
  periodEnd: string | null;
  label: string | null;
  eventsInPeriod: number;
  openEventsInPeriod: number;
  teamPendingCount: number;
}

export interface MinistryResponse {
  id: string;
  churchId: string;
  name: string;
  description: string | null;
  hasRoster: boolean;
  isActive: boolean;
  availabilityWindow: RosterAvailabilityWindowResponse | null;
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
  usesRoster: boolean;
  rosterOpen: boolean;
  visibleToChurch: boolean;
  rosterSlots?: EventRosterSlotResponse[];
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
  instruments: string[];
  roles: Array<{
    id: string;
    name: string;
    canManageEvents: boolean;
  }>;
  canManageEvents: boolean;
  startedAt: string | null;
}

export interface WorshipAvailabilityEventResponse {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string | null;
  location: string | null;
  recurrenceSeriesId: string | null;
  isRecurring: boolean;
  rosterOpen: boolean;
  rosterRoles: string[];
  myStatus: 'available' | 'unavailable' | null;
  myRoleLabels: string[];
  availableCount: number;
  unavailableCount: number;
  pendingCount: number;
}

export interface WorshipSeriesGroupResponse {
  key: string;
  name: string;
  isRecurring: boolean;
  rosterRoles: string[];
  myProfileRoleLabels: string[];
  openCount: number;
  myAvailableCount: number;
  myUnavailableCount: number;
  myPendingCount: number;
  occurrences: WorshipAvailabilityEventResponse[];
}

export interface EventRosterSlotResponse {
  id: string;
  eventId: string;
  label: string;
  sortOrder: number;
  assignedMemberId: string | null;
  assignedMemberName: string | null;
}

export interface EventRosterAssignmentResponse {
  id: string;
  eventId: string;
  memberId: string;
  memberName: string;
  rosterSlotId: string;
  roleLabel: string;
  availabilityStatus: 'available' | 'unavailable' | null;
}

export interface EventRosterCandidateResponse {
  memberId: string;
  memberName: string;
  availabilityStatus: 'available' | 'unavailable' | null;
  roleLabels: string[];
}

export interface RosterProfileResponse {
  ministryId: string;
  ministryName: string;
  hasRoster: true;
  memberId: string;
  /** Funções cadastradas pelo membro neste ministério. */
  instruments: string[];
  needsRosterFunctions: boolean;
  availabilityWindow: RosterAvailabilityWindowResponse;
  series: WorshipSeriesGroupResponse[];
  summary: {
    totalOpen: number;
    available: number;
    unavailable: number;
    pending: number;
  };
}

export interface MyScheduleAssignmentResponse {
  eventId: string;
  ministryId: string | null;
  ministryName: string | null;
  name: string;
  startsAt: string;
  endsAt: string | null;
  location: string | null;
  roleLabel: string;
}

export interface MyScheduleRosterEntryResponse {
  memberId: string;
  memberName: string;
  roleLabel: string;
}

export interface MyScheduleEventResponse {
  eventId: string;
  ministryId: string | null;
  ministryName: string | null;
  name: string;
  startsAt: string;
  endsAt: string | null;
  location: string | null;
  rosterOpen: boolean;
  rosterRoles: string[];
  profileKey: string;
  myProfileRoleLabels: string[];
  myAvailabilityStatus: 'available' | 'unavailable' | null;
  myRoleLabels: string[];
  myRoleLabel: string | null;
  roster: MyScheduleRosterEntryResponse[];
}

export interface MySchedulePendingResponse {
  eventId: string;
  ministryId: string | null;
  ministryName: string | null;
  name: string;
  startsAt: string;
  location: string | null;
}

export interface MyMinistryScheduleResponse {
  ministryId: string;
  ministryName: string;
  availabilityWindow: {
    active: boolean;
    periodType: RosterAvailabilityWindowResponse['periodType'];
    periodStart: string | null;
    periodEnd: string | null;
    label: string | null;
  };
  pendingAvailability: MySchedulePendingResponse[];
  upcomingAssignments: MyScheduleAssignmentResponse[];
  events: MyScheduleEventResponse[];
  rosterFunctions: string[];
  needsRosterFunctions: boolean;
}

export interface MySchedulesResponse {
  hasRosterMinistries: boolean;
  hasSchedule: boolean;
  churchWide: MyMinistryScheduleResponse | null;
  summary: {
    pendingAvailabilityCount: number;
    upcomingAssignmentsCount: number;
    missingRosterFunctionsCount: number;
    nextAssignment: MyScheduleAssignmentResponse | null;
  };
  ministries: MyMinistryScheduleResponse[];
}

export function toMinistryRoleResponse(
  role: MinistryRole,
): MinistryRoleResponse {
  return {
    id: role.id,
    ministryId: role.ministryId,
    name: role.name,
    sortOrder: role.sortOrder,
    canManageEvents: role.canManageEvents,
    canManageRoster: role.canManageRoster,
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
    hasRoster: ministry.hasRoster,
    isActive: ministry.isActive,
    availabilityWindow: null,
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
    endDate: series.endDate ? series.endDate.toISOString().slice(0, 10) : null,
    maxOccurrences: series.maxOccurrences,
  };
}

export function toMinistryEventResponse(
  event: MinistryEvent & {
    ministry: Ministry | null;
    recurrenceSeries?: EventRecurrenceSeries | null;
    rosterSlots?: Array<{
      id: string;
      eventId: string;
      label: string;
      sortOrder: number;
      assignments: Array<{
        memberId: string;
        member: { name: string };
      }>;
    }>;
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
    usesRoster: event.usesRoster,
    rosterOpen: event.rosterOpen,
    visibleToChurch: event.visibleToChurch,
    rosterSlots: event.rosterSlots
      ? event.rosterSlots.map(toEventRosterSlotResponse)
      : undefined,
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
  };
}
