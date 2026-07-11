import { BadRequestException } from '@nestjs/common';
import { EventRecurrenceFrequency } from '@prisma/client';

import {
  DEFAULT_RECURRENCE_HORIZON_MONTHS,
  MAX_RECURRENCE_OCCURRENCES,
  type EventRecurrenceInput,
} from './event-recurrence.types';

function copyTime(target: Date, source: Date): Date {
  const next = new Date(target);
  next.setHours(
    source.getHours(),
    source.getMinutes(),
    source.getSeconds(),
    source.getMilliseconds(),
  );
  return next;
}

function startOfWeekSunday(date: Date): Date {
  const next = new Date(date);
  const day = next.getDay();
  next.setDate(next.getDate() - day);
  next.setHours(0, 0, 0, 0);
  return next;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonthsClamped(
  date: Date,
  months: number,
  dayOfMonth: number,
): Date | null {
  const next = new Date(date);
  next.setDate(1);
  next.setMonth(next.getMonth() + months);

  const lastDay = new Date(
    next.getFullYear(),
    next.getMonth() + 1,
    0,
  ).getDate();
  if (dayOfMonth > lastDay) {
    return null;
  }

  next.setDate(dayOfMonth);
  return copyTime(next, date);
}

function addYearsClamped(date: Date, years: number): Date | null {
  const next = new Date(date);
  const month = next.getMonth();
  const day = next.getDate();

  next.setFullYear(next.getFullYear() + years);

  if (next.getMonth() !== month || next.getDate() !== day) {
    return null;
  }

  return next;
}

function resolveEndLimit(
  firstStart: Date,
  recurrence: EventRecurrenceInput,
): Date {
  if (recurrence.endDate) {
    const end = new Date(`${recurrence.endDate}T23:59:59.999`);
    return end;
  }

  const horizon = new Date(firstStart);
  horizon.setMonth(horizon.getMonth() + DEFAULT_RECURRENCE_HORIZON_MONTHS);
  horizon.setHours(23, 59, 59, 999);
  return horizon;
}

function resolveMaxCount(recurrence: EventRecurrenceInput): number {
  if (recurrence.maxOccurrences) {
    return Math.min(recurrence.maxOccurrences, MAX_RECURRENCE_OCCURRENCES);
  }

  return MAX_RECURRENCE_OCCURRENCES;
}

function generateDaily(
  firstStart: Date,
  interval: number,
  endLimit: Date,
  maxCount: number,
): Date[] {
  const results = [new Date(firstStart)];
  let current = new Date(firstStart);

  while (results.length < maxCount) {
    current = addDays(current, interval);
    if (current > endLimit) {
      break;
    }
    results.push(new Date(current));
  }

  return results;
}

function generateWeekly(
  firstStart: Date,
  interval: number,
  daysOfWeek: number[],
  endLimit: Date,
  maxCount: number,
): Date[] {
  const results = [new Date(firstStart)];
  const anchorWeek = startOfWeekSunday(firstStart);
  let cursor = addDays(firstStart, 1);
  cursor.setHours(0, 0, 0, 0);

  while (results.length < maxCount && cursor <= endLimit) {
    if (daysOfWeek.includes(cursor.getDay())) {
      const cursorWeek = startOfWeekSunday(cursor);
      const weeksSince = Math.round(
        (cursorWeek.getTime() - anchorWeek.getTime()) /
          (7 * 24 * 60 * 60 * 1000),
      );

      if (weeksSince % interval === 0) {
        const occurrence = copyTime(cursor, firstStart);
        if (occurrence >= firstStart && occurrence <= endLimit) {
          results.push(occurrence);
        }
      }
    }

    cursor = addDays(cursor, 1);
  }

  return results
    .sort((a, b) => a.getTime() - b.getTime())
    .filter(
      (date, index, array) =>
        index === 0 || date.getTime() !== array[index - 1].getTime(),
    )
    .slice(0, maxCount);
}

function generateMonthly(
  firstStart: Date,
  interval: number,
  endLimit: Date,
  maxCount: number,
): Date[] {
  const results = [new Date(firstStart)];
  const dayOfMonth = firstStart.getDate();
  let monthsAdded = 0;

  while (results.length < maxCount) {
    monthsAdded += interval;
    const next = addMonthsClamped(firstStart, monthsAdded, dayOfMonth);

    if (!next || next > endLimit) {
      break;
    }

    results.push(next);
  }

  return results;
}

function generateYearly(
  firstStart: Date,
  interval: number,
  endLimit: Date,
  maxCount: number,
): Date[] {
  const results = [new Date(firstStart)];
  let yearsAdded = 0;

  while (results.length < maxCount) {
    yearsAdded += interval;
    const next = addYearsClamped(firstStart, yearsAdded);

    if (!next || next > endLimit) {
      break;
    }

    results.push(next);
  }

  return results;
}

export function validateRecurrenceInput(
  recurrence: EventRecurrenceInput,
): void {
  if (recurrence.interval < 1 || recurrence.interval > 99) {
    throw new BadRequestException(
      'O intervalo de repetição deve ser entre 1 e 99.',
    );
  }

  if (recurrence.frequency === EventRecurrenceFrequency.weekly) {
    const days = recurrence.daysOfWeek ?? [];

    if (days.length === 0) {
      throw new BadRequestException('Selecione ao menos um dia da semana.');
    }

    if (days.some((day) => day < 0 || day > 6)) {
      throw new BadRequestException('Dia da semana inválido.');
    }
  }

  if (recurrence.maxOccurrences !== undefined) {
    if (recurrence.maxOccurrences < 2) {
      throw new BadRequestException('Informe ao menos 2 ocorrências.');
    }

    if (recurrence.maxOccurrences > MAX_RECURRENCE_OCCURRENCES) {
      throw new BadRequestException(
        `O máximo é ${MAX_RECURRENCE_OCCURRENCES} ocorrências por série.`,
      );
    }
  }

  if (recurrence.endDate && recurrence.maxOccurrences) {
    throw new BadRequestException(
      'Informe apenas data final ou número de ocorrências.',
    );
  }
}

export function generateRecurrenceOccurrences(
  firstStart: Date,
  recurrence: EventRecurrenceInput,
): Date[] {
  validateRecurrenceInput(recurrence);

  const interval = recurrence.interval;
  const endLimit = resolveEndLimit(firstStart, recurrence);
  const maxCount = resolveMaxCount(recurrence);

  let results: Date[];

  switch (recurrence.frequency) {
    case EventRecurrenceFrequency.daily:
      results = generateDaily(firstStart, interval, endLimit, maxCount);
      break;
    case EventRecurrenceFrequency.weekly:
      results = generateWeekly(
        firstStart,
        interval,
        recurrence.daysOfWeek ?? [firstStart.getDay()],
        endLimit,
        maxCount,
      );
      break;
    case EventRecurrenceFrequency.monthly:
      results = generateMonthly(firstStart, interval, endLimit, maxCount);
      break;
    case EventRecurrenceFrequency.yearly:
      results = generateYearly(firstStart, interval, endLimit, maxCount);
      break;
    default:
      throw new BadRequestException('Frequência de repetição inválida.');
  }

  if (results.length < 2) {
    throw new BadRequestException(
      'A repetição precisa gerar ao menos 2 ocorrências com as regras informadas.',
    );
  }

  return results;
}
