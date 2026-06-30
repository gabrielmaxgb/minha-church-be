import { ChurchPlanTier } from '@prisma/client';

const TIER_ORDER: readonly ChurchPlanTier[] = [
  ChurchPlanTier.starter,
  ChurchPlanTier.small,
  ChurchPlanTier.growth,
  ChurchPlanTier.consolidated,
  ChurchPlanTier.enterprise,
];

const RETENTION_DAYS: Record<ChurchPlanTier, number> = {
  [ChurchPlanTier.starter]: 30,
  [ChurchPlanTier.small]: 60,
  [ChurchPlanTier.growth]: 90,
  [ChurchPlanTier.consolidated]: 180,
  [ChurchPlanTier.enterprise]: 365,
};

export function tierFromMemberCount(memberCount: number): ChurchPlanTier {
  if (memberCount <= 100) {
    return ChurchPlanTier.small;
  }

  if (memberCount <= 300) {
    return ChurchPlanTier.growth;
  }

  if (memberCount <= 700) {
    return ChurchPlanTier.consolidated;
  }

  return ChurchPlanTier.enterprise;
}

export function effectivePlanTier(
  planTier: ChurchPlanTier,
  memberCount: number,
): ChurchPlanTier {
  const planIndex = TIER_ORDER.indexOf(planTier);
  const sizeIndex = TIER_ORDER.indexOf(tierFromMemberCount(memberCount));

  return TIER_ORDER[Math.max(planIndex, sizeIndex)];
}

export function getAuditRetentionDays(
  planTier: ChurchPlanTier,
  memberCount: number,
): number {
  return RETENTION_DAYS[effectivePlanTier(planTier, memberCount)];
}

export function getRetentionCutoff(
  planTier: ChurchPlanTier,
  memberCount: number,
  now = new Date(),
): Date {
  const days = getAuditRetentionDays(planTier, memberCount);
  const cutoff = new Date(now);

  cutoff.setUTCDate(cutoff.getUTCDate() - days);

  return cutoff;
}
