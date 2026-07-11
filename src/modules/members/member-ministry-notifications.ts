import { needsRosterFunctions } from '../ministries/roster-roles';

export interface MinistryNeedsFunctionsNotification {
  ministryId: string;
  ministryName: string;
}

export interface MinistryCatalogUpdateNotification {
  ministryId: string;
  ministryName: string;
  updatedAt: string;
}

export interface MyMinistryNotificationsResponse {
  needsFunctions: MinistryNeedsFunctionsNotification[];
  catalogUpdates: MinistryCatalogUpdateNotification[];
  summary: {
    needsFunctionsCount: number;
    catalogUpdatesCount: number;
    totalCount: number;
  };
}

type MemberMinistryLinkRow = {
  instruments: string[];
  serviceFunctionsCatalogSeenAt: Date | null;
  ministry: {
    id: string;
    name: string;
    serviceFunctionsUpdatedAt: Date;
    serviceFunctions: Array<{ id: string }>;
  };
};

export function buildMyMinistryNotifications(
  links: MemberMinistryLinkRow[],
): MyMinistryNotificationsResponse {
  const needsFunctions: MinistryNeedsFunctionsNotification[] = [];
  const catalogUpdates: MinistryCatalogUpdateNotification[] = [];

  for (const link of links) {
    const hasCatalog = link.ministry.serviceFunctions.length > 0;

    if (!hasCatalog) {
      continue;
    }

    if (needsRosterFunctions(link.instruments)) {
      needsFunctions.push({
        ministryId: link.ministry.id,
        ministryName: link.ministry.name,
      });
      continue;
    }

    const seenAt = link.serviceFunctionsCatalogSeenAt?.getTime() ?? 0;
    const updatedAt = link.ministry.serviceFunctionsUpdatedAt.getTime();

    if (updatedAt > seenAt) {
      catalogUpdates.push({
        ministryId: link.ministry.id,
        ministryName: link.ministry.name,
        updatedAt: link.ministry.serviceFunctionsUpdatedAt.toISOString(),
      });
    }
  }

  return {
    needsFunctions,
    catalogUpdates,
    summary: {
      needsFunctionsCount: needsFunctions.length,
      catalogUpdatesCount: catalogUpdates.length,
      totalCount: needsFunctions.length + catalogUpdates.length,
    },
  };
}

export function ministryHasServiceFunctionCatalog(
  serviceFunctions: Array<{ id: string }>,
): boolean {
  return serviceFunctions.length > 0;
}

export function memberNeedsServiceFunctions(
  instruments: string[],
  serviceFunctions: Array<{ id: string }>,
): boolean {
  return (
    ministryHasServiceFunctionCatalog(serviceFunctions) &&
    needsRosterFunctions(instruments)
  );
}
