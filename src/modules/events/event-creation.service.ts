import { Injectable } from '@nestjs/common';
import type {
  EventRecurrenceSeries,
  Ministry,
  MinistryEvent,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import type { EventRecurrenceDto } from './dto/event-recurrence.dto';
import { generateRecurrenceOccurrences } from './event-recurrence.generator';
import type { EventRecurrenceInput } from './event-recurrence.types';

export interface CreateEventData {
  churchId: string;
  ministryId: string | null;
  name: string;
  description?: string | null;
  location?: string | null;
  startsAt: Date;
  endsAt: Date | null;
  createdByUserId: string;
  recurrence?: EventRecurrenceDto;
  rosterOpen?: boolean;
}

const eventInclude = {
  ministry: true,
  recurrenceSeries: true,
} satisfies Prisma.MinistryEventInclude;

export type MinistryEventWithRelations = MinistryEvent & {
  ministry: Ministry | null;
  recurrenceSeries: EventRecurrenceSeries | null;
};

@Injectable()
export class EventCreationService {
  constructor(private readonly prisma: PrismaService) {}

  async createEvent(data: CreateEventData): Promise<{
    event: MinistryEventWithRelations;
    occurrencesCreated: number;
  }> {
    const rosterOpen = data.rosterOpen ?? false;

    if (!data.recurrence) {
      const event = await this.prisma.ministryEvent.create({
        data: {
          churchId: data.churchId,
          ministryId: data.ministryId,
          name: data.name.trim(),
          description: data.description,
          location: data.location,
          startsAt: data.startsAt,
          endsAt: data.endsAt,
          createdByUserId: data.createdByUserId,
          rosterOpen,
        },
        include: eventInclude,
      });

      return { event, occurrencesCreated: 1 };
    }

    const recurrenceInput = this.toRecurrenceInput(
      data.recurrence,
      data.startsAt,
    );
    const occurrenceStarts = generateRecurrenceOccurrences(
      data.startsAt,
      recurrenceInput,
    );
    const durationMs =
      data.endsAt !== null
        ? data.endsAt.getTime() - data.startsAt.getTime()
        : null;

    return this.prisma.$transaction(async (tx) => {
      const series = await tx.eventRecurrenceSeries.create({
        data: {
          churchId: data.churchId,
          ministryId: data.ministryId,
          frequency: recurrenceInput.frequency,
          interval: recurrenceInput.interval,
          daysOfWeek: recurrenceInput.daysOfWeek ?? [],
          endDate: recurrenceInput.endDate
            ? new Date(`${recurrenceInput.endDate}T12:00:00`)
            : null,
          maxOccurrences: recurrenceInput.maxOccurrences ?? null,
        },
      });

      await tx.ministryEvent.createMany({
        data: occurrenceStarts.map((startsAt) => ({
          churchId: data.churchId,
          ministryId: data.ministryId,
          name: data.name.trim(),
          description: data.description,
          location: data.location,
          startsAt,
          endsAt:
            durationMs !== null
              ? new Date(startsAt.getTime() + durationMs)
              : null,
          createdByUserId: data.createdByUserId,
          recurrenceSeriesId: series.id,
          rosterOpen,
        })),
      });

      const event = await tx.ministryEvent.findFirstOrThrow({
        where: {
          churchId: data.churchId,
          recurrenceSeriesId: series.id,
        },
        orderBy: { startsAt: 'asc' },
        include: eventInclude,
      });

      return {
        event,
        occurrencesCreated: occurrenceStarts.length,
      };
    });
  }

  private toRecurrenceInput(
    recurrence: EventRecurrenceDto,
    startsAt: Date,
  ): EventRecurrenceInput {
    return {
      frequency: recurrence.frequency,
      interval: recurrence.interval ?? 1,
      daysOfWeek:
        recurrence.frequency === 'weekly'
          ? (recurrence.daysOfWeek ?? [startsAt.getDay()])
          : recurrence.daysOfWeek,
      endDate: recurrence.endDate,
      maxOccurrences: recurrence.maxOccurrences,
    };
  }
}
