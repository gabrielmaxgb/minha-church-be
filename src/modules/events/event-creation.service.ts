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
import { createEventRosterSlots, createEventRosterSlotsForEvents, resolveRosterSlotPlan, type RosterSlotPlanItem } from './event-roster-slots';

export interface CreateEventData {
  churchId: string;
  ministryId: string | null;
  name: string;
  description?: string | null;
  availabilityMessage?: string | null;
  location?: string | null;
  startsAt: Date;
  endsAt: Date | null;
  createdByUserId: string;
  recurrence?: EventRecurrenceDto;
  usesRoster?: boolean;
  rosterOpen?: boolean;
  rosterRoles?: string[];
  rosterSlotPlan?: RosterSlotPlanItem[];
  visibleToChurch?: boolean;
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
    const usesRoster = data.usesRoster ?? false;
    const rosterOpen = usesRoster ? (data.rosterOpen ?? false) : false;
    const rosterSlotPlan = usesRoster
      ? resolveRosterSlotPlan({
          rosterSlotPlan: data.rosterSlotPlan,
          rosterRoles: data.rosterRoles,
        })
      : [];
    const visibleToChurch = data.ministryId
      ? (data.visibleToChurch ?? true)
      : true;

    if (!data.recurrence) {
      const event = await this.prisma.ministryEvent.create({
        data: {
          churchId: data.churchId,
          ministryId: data.ministryId,
          name: data.name.trim(),
          description: data.description,
          availabilityMessage: data.availabilityMessage,
          location: data.location,
          startsAt: data.startsAt,
          endsAt: data.endsAt,
          createdByUserId: data.createdByUserId,
          usesRoster,
          rosterOpen,
          visibleToChurch,
        },
        include: eventInclude,
      });

      if (rosterSlotPlan.length > 0) {
        await createEventRosterSlots(this.prisma, event.id, rosterSlotPlan);
      }

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

    return this.prisma.$transaction(
      async (tx) => {
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
            availabilityMessage: data.availabilityMessage,
            location: data.location,
            startsAt,
            endsAt:
              durationMs !== null
                ? new Date(startsAt.getTime() + durationMs)
                : null,
            createdByUserId: data.createdByUserId,
            recurrenceSeriesId: series.id,
            usesRoster,
            rosterOpen,
            visibleToChurch,
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

        if (rosterSlotPlan.length > 0) {
          const seriesEvents = await tx.ministryEvent.findMany({
            where: {
              churchId: data.churchId,
              recurrenceSeriesId: series.id,
              deletedAt: null,
            },
            select: { id: true },
          });

          await createEventRosterSlotsForEvents(
            tx,
            seriesEvents.map((item) => item.id),
            rosterSlotPlan,
          );
        }

        return {
          event,
          occurrencesCreated: occurrenceStarts.length,
        };
      },
      { maxWait: 10_000, timeout: 60_000 },
    );
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
