import type { WorshipAvailabilityPeriod } from '@prisma/client';

export const WORSHIP_AVAILABILITY_PERIODS = [
  'weekly',
  'monthly',
  'quarterly',
  'semiannual',
  'annual',
] as const satisfies readonly WorshipAvailabilityPeriod[];

export type WorshipAvailabilityPeriodValue =
  (typeof WORSHIP_AVAILABILITY_PERIODS)[number];

function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function endOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      23,
      59,
      59,
      999,
    ),
  );
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addUtcMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

/** Segunda-feira da semana que contém a data (UTC). */
function startOfUtcWeek(date: Date): Date {
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  return startOfUtcDay(addUtcDays(date, diff));
}

function startOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function endOfUtcMonth(date: Date): Date {
  return endOfUtcDay(
    new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)),
  );
}

function startOfUtcQuarter(date: Date): Date {
  const quarterMonth = Math.floor(date.getUTCMonth() / 3) * 3;
  return new Date(Date.UTC(date.getUTCFullYear(), quarterMonth, 1));
}

function endOfUtcQuarter(date: Date): Date {
  const start = startOfUtcQuarter(date);
  return endOfUtcDay(addUtcDays(addUtcMonths(start, 3), -1));
}

function startOfUtcHalfYear(date: Date): Date {
  const month = date.getUTCMonth() < 6 ? 0 : 6;
  return new Date(Date.UTC(date.getUTCFullYear(), month, 1));
}

function endOfUtcHalfYear(date: Date): Date {
  const start = startOfUtcHalfYear(date);
  return endOfUtcDay(addUtcDays(addUtcMonths(start, 6), -1));
}

function startOfUtcYear(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
}

function endOfUtcYear(date: Date): Date {
  return endOfUtcDay(new Date(Date.UTC(date.getUTCFullYear(), 11, 31)));
}

export function defaultPeriodStart(
  periodType: WorshipAvailabilityPeriod,
  reference = new Date(),
): Date {
  switch (periodType) {
    case 'weekly':
      return startOfUtcWeek(reference);
    case 'monthly':
      return startOfUtcMonth(reference);
    case 'quarterly':
      return startOfUtcQuarter(reference);
    case 'semiannual':
      return startOfUtcHalfYear(reference);
    case 'annual':
      return startOfUtcYear(reference);
    default:
      return startOfUtcDay(reference);
  }
}

export function computePeriodBounds(
  periodType: WorshipAvailabilityPeriod,
  startDate: Date,
): { start: Date; end: Date } {
  const start = startOfUtcDay(startDate);

  switch (periodType) {
    case 'weekly':
      return { start, end: endOfUtcDay(addUtcDays(start, 6)) };
    case 'monthly':
      return { start, end: endOfUtcMonth(start) };
    case 'quarterly':
      return { start, end: endOfUtcQuarter(start) };
    case 'semiannual':
      return { start, end: endOfUtcHalfYear(start) };
    case 'annual':
      return { start, end: endOfUtcYear(start) };
    default:
      return { start, end: endOfUtcMonth(start) };
  }
}

export function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isEventInAvailabilityWindow(
  eventStartsAt: Date,
  window: {
    availabilityWindowActive: boolean;
    availabilityPeriodStart: Date | null;
    availabilityPeriodEnd: Date | null;
  },
): boolean {
  if (
    !window.availabilityWindowActive ||
    !window.availabilityPeriodStart ||
    !window.availabilityPeriodEnd
  ) {
    return false;
  }

  const start = startOfUtcDay(window.availabilityPeriodStart);
  const end = endOfUtcDay(window.availabilityPeriodEnd);

  return eventStartsAt >= start && eventStartsAt <= end;
}

export function formatPeriodLabel(
  periodType: WorshipAvailabilityPeriod,
  start: Date,
  end: Date,
): string {
  const fmt = new Intl.DateTimeFormat('pt-BR', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  const fmtMonth = new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const fmtYear = new Intl.DateTimeFormat('pt-BR', {
    year: 'numeric',
    timeZone: 'UTC',
  });

  switch (periodType) {
    case 'weekly':
      return `Semana ${fmt.format(start)} – ${fmt.format(end)}`;
    case 'monthly':
      return fmtMonth.format(start);
    case 'quarterly':
      return `Trimestre ${fmt.format(start)} – ${fmt.format(end)}`;
    case 'semiannual':
      return `Semestre ${fmt.format(start)} – ${fmt.format(end)}`;
    case 'annual':
      return fmtYear.format(start);
    default:
      return `${fmt.format(start)} – ${fmt.format(end)}`;
  }
}
