export function normalizeRosterSlotLabels(labels: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of labels) {
    const label = raw.trim();

    if (!label) {
      continue;
    }

    const key = label.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(label);
  }

  return result;
}

import type { PrismaClient } from '@prisma/client';

type RosterSlotClient = Pick<
  PrismaClient,
  'eventRosterSlot' | 'eventRosterAssignment'
>;

export async function syncEventRosterSlots(
  client: RosterSlotClient,
  eventId: string,
  labels: string[],
): Promise<void> {
  const normalized = normalizeRosterSlotLabels(labels);
  const existing = await client.eventRosterSlot.findMany({
    where: { eventId },
    include: { assignments: true },
    orderBy: { sortOrder: 'asc' },
  });

  const existingByLabel = new Map(
    existing.map((slot) => [slot.label.toLowerCase(), slot]),
  );
  const nextIds = new Set<string>();

  for (let index = 0; index < normalized.length; index += 1) {
    const label = normalized[index];
    const key = label.toLowerCase();
    const current = existingByLabel.get(key);

    if (current) {
      nextIds.add(current.id);

      if (current.sortOrder !== index || current.label !== label) {
        await client.eventRosterSlot.update({
          where: { id: current.id },
          data: { label, sortOrder: index },
        });

        if (current.label !== label) {
          await client.eventRosterAssignment.updateMany({
            where: { rosterSlotId: current.id },
            data: { roleLabel: label },
          });
        }
      }

      continue;
    }

    await client.eventRosterSlot.create({
      data: {
        eventId,
        label,
        sortOrder: index,
      },
    });
  }

  for (const slot of existing) {
    if (nextIds.has(slot.id)) {
      continue;
    }

    if (slot.assignments.length > 0) {
      continue;
    }

    await client.eventRosterSlot.delete({ where: { id: slot.id } });
  }
}

export async function createEventRosterSlots(
  client: RosterSlotClient,
  eventId: string,
  labels: string[],
): Promise<void> {
  await createEventRosterSlotsForEvents(client, [eventId], labels);
}

export async function createEventRosterSlotsForEvents(
  client: RosterSlotClient,
  eventIds: string[],
  labels: string[],
): Promise<void> {
  const normalized = normalizeRosterSlotLabels(labels);

  if (normalized.length === 0 || eventIds.length === 0) {
    return;
  }

  await client.eventRosterSlot.createMany({
    data: eventIds.flatMap((eventId) =>
      normalized.map((label, index) => ({
        eventId,
        label,
        sortOrder: index,
      })),
    ),
  });
}

export type EventRosterSlotWithAssignment = {
  id: string;
  eventId: string;
  label: string;
  sortOrder: number;
  assignments: Array<{
    memberId: string;
    member: { name: string };
  }>;
};

export function toEventRosterSlotResponse(slot: EventRosterSlotWithAssignment) {
  const assignment = slot.assignments[0] ?? null;

  return {
    id: slot.id,
    eventId: slot.eventId,
    label: slot.label,
    sortOrder: slot.sortOrder,
    assignedMemberId: assignment?.memberId ?? null,
    assignedMemberName: assignment?.member.name ?? null,
  };
}
