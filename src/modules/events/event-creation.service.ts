import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  EventRecurrenceSeries,
  Ministry,
  MinistryEvent,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import type { EventRecurrenceDto } from './dto/event-recurrence.dto';
import type { EventMutationScope } from './dto/event-mutation-scope';
import { generateRecurrenceOccurrences } from './event-recurrence.generator';
import type { EventRecurrenceInput } from './event-recurrence.types';
import {
  createEventRosterSlots,
  createEventRosterSlotsForEvents,
  resolveRosterSlotPlan,
  type RosterSlotPlanItem,
} from './event-roster-slots';

export interface CreateEventData {
  churchId: string;
  ministryId: string | null;
  name: string;
  description?: string | null;
  highlightNote?: string | null;
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

export interface ApplyRecurrenceUpdateData {
  churchId: string;
  event: MinistryEvent;
  scope: EventMutationScope;
  recurrence: EventRecurrenceDto | null;
  name: string;
  description: string | null;
  highlightNote: string | null;
  availabilityMessage: string | null;
  location: string | null;
  startsAt: Date;
  endsAt: Date | null;
  usesRoster: boolean;
  rosterOpen: boolean;
  visibleToChurch: boolean;
  rosterSlotPlan: RosterSlotPlanItem[];
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
    const usesRoster = data.usesRoster ?? true;
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
          highlightNote: data.highlightNote,
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
            highlightNote: data.highlightNote,
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

  /**
   * Atualiza / cria / remove recorrência e rematerializa ocorrências no escopo.
   * Mantém o id do evento âncora (o que está sendo editado).
   */
  async applyRecurrenceUpdate(
    data: ApplyRecurrenceUpdateData,
  ): Promise<MinistryEventWithRelations> {
    const existing = data.event;

    if (
      data.recurrence !== null &&
      existing.recurrenceSeriesId &&
      data.scope === 'this'
    ) {
      throw new BadRequestException(
        'Para alterar a recorrência, escolha “este e os seguintes” ou “todos os eventos da série”.',
      );
    }

    if (data.recurrence === null) {
      return this.clearRecurrence(data);
    }

    return this.rematerializeRecurrence(data, data.recurrence);
  }

  private async clearRecurrence(
    data: ApplyRecurrenceUpdateData,
  ): Promise<MinistryEventWithRelations> {
    const existing = data.event;
    const deletedAt = new Date();

    return this.prisma.$transaction(
      async (tx) => {
        if (existing.recurrenceSeriesId && data.scope !== 'this') {
          const whereOthers: Prisma.MinistryEventWhereInput = {
            churchId: data.churchId,
            recurrenceSeriesId: existing.recurrenceSeriesId,
            deletedAt: null,
            id: { not: existing.id },
          };

          if (data.scope === 'this_and_following') {
            whereOthers.startsAt = { gte: existing.startsAt };
          }

          await tx.ministryEvent.updateMany({
            where: whereOthers,
            data: { deletedAt },
          });
        }

        return tx.ministryEvent.update({
          where: { id: existing.id },
          data: {
            name: data.name.trim(),
            description: data.description,
            highlightNote: data.highlightNote,
            availabilityMessage: data.availabilityMessage,
            location: data.location,
            startsAt: data.startsAt,
            endsAt: data.endsAt,
            usesRoster: data.usesRoster,
            rosterOpen: data.rosterOpen,
            visibleToChurch: data.visibleToChurch,
            recurrenceSeriesId: null,
          },
          include: eventInclude,
        });
      },
      { maxWait: 10_000, timeout: 60_000 },
    );
  }

  private async rematerializeRecurrence(
    data: ApplyRecurrenceUpdateData,
    recurrence: EventRecurrenceDto,
  ): Promise<MinistryEventWithRelations> {
    const existing = data.event;
    const deletedAt = new Date();

    let anchorStart = data.startsAt;

    if (data.scope === 'all' && existing.recurrenceSeriesId) {
      const first = await this.prisma.ministryEvent.findFirst({
        where: {
          churchId: data.churchId,
          recurrenceSeriesId: existing.recurrenceSeriesId,
          deletedAt: null,
        },
        orderBy: { startsAt: 'asc' },
      });

      if (first) {
        const timeDeltaMs =
          data.startsAt.getTime() - existing.startsAt.getTime();
        anchorStart = new Date(first.startsAt.getTime() + timeDeltaMs);
      }
    }

    const recurrenceInput = this.toRecurrenceInput(recurrence, anchorStart);
    const occurrenceStarts = generateRecurrenceOccurrences(
      anchorStart,
      recurrenceInput,
    );
    const durationMs =
      data.endsAt !== null
        ? data.endsAt.getTime() - data.startsAt.getTime()
        : null;

    const rosterSlotPlan = data.usesRoster ? data.rosterSlotPlan : [];

    return this.prisma.$transaction(
      async (tx) => {
        if (existing.recurrenceSeriesId) {
          const whereOthers: Prisma.MinistryEventWhereInput = {
            churchId: data.churchId,
            recurrenceSeriesId: existing.recurrenceSeriesId,
            deletedAt: null,
            id: { not: existing.id },
          };

          if (data.scope === 'this_and_following') {
            whereOthers.startsAt = { gte: existing.startsAt };
          }

          await tx.ministryEvent.updateMany({
            where: whereOthers,
            data: { deletedAt },
          });
        }

        const series =
          data.scope === 'all' && existing.recurrenceSeriesId
            ? await tx.eventRecurrenceSeries.update({
                where: { id: existing.recurrenceSeriesId },
                data: {
                  frequency: recurrenceInput.frequency,
                  interval: recurrenceInput.interval,
                  daysOfWeek: recurrenceInput.daysOfWeek ?? [],
                  endDate: recurrenceInput.endDate
                    ? new Date(`${recurrenceInput.endDate}T12:00:00`)
                    : null,
                  maxOccurrences: recurrenceInput.maxOccurrences ?? null,
                },
              })
            : await tx.eventRecurrenceSeries.create({
                data: {
                  churchId: data.churchId,
                  ministryId: existing.ministryId,
                  frequency: recurrenceInput.frequency,
                  interval: recurrenceInput.interval,
                  daysOfWeek: recurrenceInput.daysOfWeek ?? [],
                  endDate: recurrenceInput.endDate
                    ? new Date(`${recurrenceInput.endDate}T12:00:00`)
                    : null,
                  maxOccurrences: recurrenceInput.maxOccurrences ?? null,
                },
              });

        // Ao cortar a série (“este e os seguintes”), encerra a série antiga.
        if (
          data.scope === 'this_and_following' &&
          existing.recurrenceSeriesId &&
          existing.recurrenceSeriesId !== series.id
        ) {
          const dayBefore = new Date(anchorStart);
          dayBefore.setDate(dayBefore.getDate() - 1);
          dayBefore.setHours(12, 0, 0, 0);

          await tx.eventRecurrenceSeries.update({
            where: { id: existing.recurrenceSeriesId },
            data: { endDate: dayBefore },
          });
        }

        const firstStart = occurrenceStarts[0];
        const event = await tx.ministryEvent.update({
          where: { id: existing.id },
          data: {
            name: data.name.trim(),
            description: data.description,
            highlightNote: data.highlightNote,
            availabilityMessage: data.availabilityMessage,
            location: data.location,
            startsAt: firstStart,
            endsAt:
              durationMs !== null
                ? new Date(firstStart.getTime() + durationMs)
                : null,
            usesRoster: data.usesRoster,
            rosterOpen: data.rosterOpen,
            visibleToChurch: data.visibleToChurch,
            recurrenceSeriesId: series.id,
            deletedAt: null,
          },
          include: eventInclude,
        });

        const remainingStarts = occurrenceStarts.slice(1);

        if (remainingStarts.length > 0) {
          await tx.ministryEvent.createMany({
            data: remainingStarts.map((startsAt) => ({
              churchId: data.churchId,
              ministryId: existing.ministryId,
              name: data.name.trim(),
              description: data.description,
              highlightNote: data.highlightNote,
              availabilityMessage: data.availabilityMessage,
              location: data.location,
              startsAt,
              endsAt:
                durationMs !== null
                  ? new Date(startsAt.getTime() + durationMs)
                  : null,
              createdByUserId: existing.createdByUserId,
              recurrenceSeriesId: series.id,
              usesRoster: data.usesRoster,
              rosterOpen: data.rosterOpen,
              visibleToChurch: data.visibleToChurch,
            })),
          });
        }

        if (rosterSlotPlan.length > 0) {
          const seriesEvents = await tx.ministryEvent.findMany({
            where: {
              churchId: data.churchId,
              recurrenceSeriesId: series.id,
              deletedAt: null,
              id: { not: existing.id },
            },
            select: { id: true },
          });

          if (seriesEvents.length > 0) {
            await createEventRosterSlotsForEvents(
              tx,
              seriesEvents.map((item) => item.id),
              rosterSlotPlan,
            );
          }
        }

        return event;
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
