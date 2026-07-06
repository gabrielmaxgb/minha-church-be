import type { Prisma, PrismaClient } from '@prisma/client';

export const ROSTER_SLOT_MIN_REQUIRED_COUNT = 1;
export const ROSTER_SLOT_MAX_REQUIRED_COUNT = 50;

export type RosterSlotPlanItem = {
  label: string;
  requiredCount: number;
};

type RosterSlotClient = Pick<
  PrismaClient,
  'eventRosterSlot' | 'eventRosterAssignment' | 'ministryEvent'
>;

type RosterSlotWithAssignments = {
  requiredCount: number;
  assignments: Array<{ id: string }>;
};

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

export function clampRequiredCount(value: number | undefined): number {
  const parsed = Number.isFinite(value) ? Math.trunc(value as number) : 1;

  return Math.min(
    ROSTER_SLOT_MAX_REQUIRED_COUNT,
    Math.max(ROSTER_SLOT_MIN_REQUIRED_COUNT, parsed || 1),
  );
}

export function normalizeRosterSlotPlan(
  items: Array<{ label: string; requiredCount?: number }>,
): RosterSlotPlanItem[] {
  const seen = new Set<string>();
  const result: RosterSlotPlanItem[] = [];

  for (const raw of items) {
    const label = raw.label.trim();

    if (!label) {
      continue;
    }

    const key = label.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push({
      label,
      requiredCount: clampRequiredCount(raw.requiredCount),
    });
  }

  return result;
}

export function resolveRosterSlotPlan(input: {
  rosterSlotPlan?: Array<{ label: string; requiredCount?: number }>;
  rosterRoles?: string[];
}): RosterSlotPlanItem[] {
  if (input.rosterSlotPlan !== undefined) {
    return normalizeRosterSlotPlan(input.rosterSlotPlan);
  }

  if (input.rosterRoles !== undefined) {
    return normalizeRosterSlotPlan(
      input.rosterRoles.map((label) => ({ label, requiredCount: 1 })),
    );
  }

  return [];
}

export function countRequiredRosterPositions(
  slots: Array<{ requiredCount: number }>,
): number {
  return slots.reduce((total, slot) => total + slot.requiredCount, 0);
}

export function countFilledRosterPositions(
  slots: Array<{ assignments: unknown[] }>,
): number {
  return slots.reduce((total, slot) => total + slot.assignments.length, 0);
}

export function isRosterFullyStaffed(
  slots: Array<{ requiredCount: number; assignments: unknown[] }>,
): boolean {
  if (slots.length === 0) {
    return false;
  }

  return slots.every(
    (slot) => slot.assignments.length >= slot.requiredCount,
  );
}

export function slotHasVacancy(
  slot: { requiredCount: number; assignments: unknown[] },
): boolean {
  return slot.assignments.length < slot.requiredCount;
}

export class RosterSlotSyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RosterSlotSyncError';
  }
}

export async function syncEventRosterSlots(
  client: RosterSlotClient,
  eventId: string,
  plan: RosterSlotPlanItem[],
): Promise<void> {
  const normalized = normalizeRosterSlotPlan(plan);
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
    const item = normalized[index];
    const key = item.label.toLowerCase();
    const current = existingByLabel.get(key);

    if (current) {
      nextIds.add(current.id);

      if (current.assignments.length > item.requiredCount) {
        throw new RosterSlotSyncError(
          `Não é possível reduzir "${item.label}" para ${item.requiredCount} pessoa(s) com ${current.assignments.length} já escalada(s). Remova alguém da escala primeiro.`,
        );
      }

      const updates: Prisma.EventRosterSlotUpdateInput = {};

      if (current.sortOrder !== index) {
        updates.sortOrder = index;
      }

      if (current.label !== item.label) {
        updates.label = item.label;
      }

      if (current.requiredCount !== item.requiredCount) {
        updates.requiredCount = item.requiredCount;
      }

      if (Object.keys(updates).length > 0) {
        await client.eventRosterSlot.update({
          where: { id: current.id },
          data: updates,
        });

        if (current.label !== item.label) {
          await client.eventRosterAssignment.updateMany({
            where: { rosterSlotId: current.id },
            data: { roleLabel: item.label },
          });
        }
      }

      continue;
    }

    await client.eventRosterSlot.create({
      data: {
        eventId,
        label: item.label,
        requiredCount: item.requiredCount,
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
  plan: RosterSlotPlanItem[] | string[],
): Promise<void> {
  await createEventRosterSlotsForEvents(client, [eventId], plan);
}

export async function createEventRosterSlotsForEvents(
  client: RosterSlotClient,
  eventIds: string[],
  plan: RosterSlotPlanItem[] | string[],
): Promise<void> {
  const normalized = Array.isArray(plan) && typeof plan[0] === 'string'
    ? normalizeRosterSlotPlan(
        (plan as string[]).map((label) => ({ label, requiredCount: 1 })),
      )
    : normalizeRosterSlotPlan(plan as RosterSlotPlanItem[]);

  if (normalized.length === 0 || eventIds.length === 0) {
    return;
  }

  await client.eventRosterSlot.createMany({
    data: eventIds.flatMap((eventId) =>
      normalized.map((item, index) => ({
        eventId,
        label: item.label,
        requiredCount: item.requiredCount,
        sortOrder: index,
      })),
    ),
  });
}

export type EventRosterSlotWithAssignment = {
  id: string;
  eventId: string;
  label: string;
  requiredCount: number;
  sortOrder: number;
  assignments: Array<{
    memberId: string;
    member: { name: string };
  }>;
};

export function toEventRosterSlotResponse(slot: EventRosterSlotWithAssignment) {
  const firstAssignment = slot.assignments[0] ?? null;

  return {
    id: slot.id,
    eventId: slot.eventId,
    label: slot.label,
    sortOrder: slot.sortOrder,
    requiredCount: slot.requiredCount,
    assignedCount: slot.assignments.length,
    assignedMemberId: firstAssignment?.memberId ?? null,
    assignedMemberName: firstAssignment?.member.name ?? null,
  };
}

type RosterCollectionSyncClient = Pick<
  PrismaClient,
  'ministryEvent' | 'eventRosterSlot'
>;

export async function syncRosterCollectionState(
  client: RosterCollectionSyncClient,
  eventId: string,
  options: {
    reopenOnVacancy?: boolean;
    wasFullyStaffed?: boolean;
  } = {},
): Promise<void> {
  const event = await client.ministryEvent.findFirst({
    where: { id: eventId, deletedAt: null },
    select: {
      usesRoster: true,
      rosterOpen: true,
      startsAt: true,
      rosterSlots: {
        select: {
          requiredCount: true,
          assignments: { select: { id: true } },
        },
      },
    },
  });

  if (!event?.usesRoster) {
    return;
  }

  const fullyStaffed = isRosterFullyStaffed(event.rosterSlots);

  if (fullyStaffed && event.rosterOpen) {
    await client.ministryEvent.update({
      where: { id: eventId },
      data: { rosterOpen: false },
    });
    return;
  }

  if (
    options.reopenOnVacancy &&
    options.wasFullyStaffed &&
    !fullyStaffed &&
    !event.rosterOpen &&
    event.startsAt.getTime() >= Date.now()
  ) {
    await client.ministryEvent.update({
      where: { id: eventId },
      data: { rosterOpen: true },
    });
  }
}

export function wasRosterFullyStaffed(
  slots: RosterSlotWithAssignments[],
): boolean {
  return isRosterFullyStaffed(slots);
}
