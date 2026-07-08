import type { PrismaClient } from '@prisma/client';

import { normalizeRosterRoleValue } from './roster-roles';

export interface MinistryServiceFunctionItem {
  id: string;
  ministryId: string;
  label: string;
  sortOrder: number;
}

export function normalizeServiceFunctionLabels(labels: string[]): string[] {
  const seen = new Set<string>();

  return labels
    .map((item) => normalizeRosterRoleValue(item))
    .filter((item) => {
      if (!item || seen.has(item)) {
        return false;
      }

      seen.add(item);
      return true;
    });
}

export function filterMemberInstrumentsToCatalog(
  instruments: string[],
  catalogLabels: string[],
): string[] {
  const allowed = new Set(catalogLabels.map((item) => normalizeRosterRoleValue(item)));

  return normalizeServiceFunctionLabels(instruments).filter((item) =>
    allowed.has(item),
  );
}

export async function listMinistryServiceFunctions(
  prisma: PrismaClient,
  ministryId: string,
): Promise<MinistryServiceFunctionItem[]> {
  return prisma.ministryServiceFunction.findMany({
    where: { ministryId },
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      ministryId: true,
      label: true,
      sortOrder: true,
    },
  });
}

export async function replaceMinistryServiceFunctions(
  prisma: PrismaClient,
  ministryId: string,
  labels: string[],
): Promise<MinistryServiceFunctionItem[]> {
  const normalized = normalizeServiceFunctionLabels(labels);
  const existing = await prisma.ministryServiceFunction.findMany({
    where: { ministryId },
    orderBy: { sortOrder: 'asc' },
  });

  const existingByLabel = new Map(existing.map((item) => [item.label, item]));
  const nextLabelSet = new Set(normalized);
  const previousSignature = existing.map((item) => item.label).join('\u0001');
  const nextSignature = normalized.join('\u0001');
  const catalogChanged = previousSignature !== nextSignature;

  const toDelete = existing.filter((item) => !nextLabelSet.has(item.label));
  const toCreate = normalized.filter((label) => !existingByLabel.has(label));

  await prisma.$transaction(async (tx) => {
    if (toDelete.length > 0) {
      await tx.ministryServiceFunction.deleteMany({
        where: { id: { in: toDelete.map((item) => item.id) } },
      });
    }

    for (const [index, label] of normalized.entries()) {
      const current = existingByLabel.get(label);

      if (current) {
        if (current.sortOrder !== index) {
          await tx.ministryServiceFunction.update({
            where: { id: current.id },
            data: { sortOrder: index },
          });
        }

        continue;
      }

      await tx.ministryServiceFunction.create({
        data: {
          ministryId,
          label,
          sortOrder: index,
        },
      });
    }

    const links = await tx.memberMinistry.findMany({
      where: { ministryId, endedAt: null },
      select: { id: true, instruments: true },
    });

    for (const link of links) {
      const nextInstruments = filterMemberInstrumentsToCatalog(
        link.instruments,
        normalized,
      );

      if (nextInstruments.join('|') !== link.instruments.join('|')) {
        await tx.memberMinistry.update({
          where: { id: link.id },
          data: { instruments: nextInstruments },
        });
      }
    }

    if (catalogChanged) {
      await tx.ministry.update({
        where: { id: ministryId },
        data: { serviceFunctionsUpdatedAt: new Date() },
      });
    }
  });

  return listMinistryServiceFunctions(prisma, ministryId);
}
