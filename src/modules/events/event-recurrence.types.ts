import type { EventRecurrenceFrequency } from '@prisma/client';

export interface EventRecurrenceInput {
  frequency: EventRecurrenceFrequency;
  interval: number;
  daysOfWeek?: number[];
  endDate?: string;
  maxOccurrences?: number;
}

export interface EventRecurrenceResponse {
  seriesId: string;
  frequency: EventRecurrenceFrequency;
  interval: number;
  daysOfWeek: number[];
  endDate: string | null;
  maxOccurrences: number | null;
}

export const MAX_RECURRENCE_OCCURRENCES = 200;
export const DEFAULT_RECURRENCE_HORIZON_MONTHS = 24;
