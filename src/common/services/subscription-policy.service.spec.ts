import { ConfigService } from '@nestjs/config';
import { SubscriptionStatus } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { SubscriptionPolicyService } from './subscription-policy.service';

type PolicyChurch = {
  subscriptionStatus: SubscriptionStatus;
  trialEndsAt: Date | null;
  pastDueSince?: Date | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function buildService(options: {
  enforcement: boolean;
  graceDays?: number;
}): SubscriptionPolicyService {
  const config = {
    get: (key: string) => {
      if (key === 'trial.enforcement') {
        return options.enforcement;
      }
      if (key === 'trial.pastDueGraceDays') {
        return options.graceDays ?? 7;
      }
      return undefined;
    },
  } as unknown as ConfigService;

  return new SubscriptionPolicyService({} as PrismaService, config);
}

const future = () => new Date(Date.now() + 5 * DAY_MS);
const past = () => new Date(Date.now() - 5 * DAY_MS);

describe('SubscriptionPolicyService', () => {
  describe('with enforcement disabled', () => {
    const service = buildService({ enforcement: false });

    it('never locks features regardless of status', () => {
      const statuses: PolicyChurch[] = [
        { subscriptionStatus: SubscriptionStatus.active, trialEndsAt: null },
        {
          subscriptionStatus: SubscriptionStatus.trialing,
          trialEndsAt: past(),
        },
        {
          subscriptionStatus: SubscriptionStatus.past_due,
          trialEndsAt: null,
        },
        {
          subscriptionStatus: SubscriptionStatus.canceled,
          trialEndsAt: null,
        },
      ];

      for (const church of statuses) {
        expect(service.isFeaturesLocked(church)).toBe(false);
        expect(service.getLockReason(church)).toBeNull();
        expect(service.isPublicGivingEntitled(church)).toBe(true);
      }
    });
  });

  describe('with enforcement enabled', () => {
    const service = buildService({ enforcement: true, graceDays: 7 });

    it('active: unlocked, public giving on', () => {
      const church: PolicyChurch = {
        subscriptionStatus: SubscriptionStatus.active,
        trialEndsAt: null,
      };
      expect(service.isFeaturesLocked(church)).toBe(false);
      expect(service.getLockReason(church)).toBeNull();
      expect(service.isPublicGivingEntitled(church)).toBe(true);
    });

    it('trialing valid: unlocked, public giving on', () => {
      const church: PolicyChurch = {
        subscriptionStatus: SubscriptionStatus.trialing,
        trialEndsAt: future(),
      };
      expect(service.isFeaturesLocked(church)).toBe(false);
      expect(service.getLockReason(church)).toBeNull();
      expect(service.isPublicGivingEntitled(church)).toBe(true);
    });

    it('trialing expired: locked (trial_expired), public giving off', () => {
      const church: PolicyChurch = {
        subscriptionStatus: SubscriptionStatus.trialing,
        trialEndsAt: past(),
      };
      expect(service.isFeaturesLocked(church)).toBe(true);
      expect(service.getLockReason(church)).toBe('trial_expired');
      expect(service.isPublicGivingEntitled(church)).toBe(false);
    });

    it('past_due within grace: locked but public giving stays on', () => {
      const church: PolicyChurch = {
        subscriptionStatus: SubscriptionStatus.past_due,
        trialEndsAt: null,
        pastDueSince: new Date(Date.now() - 2 * DAY_MS),
      };
      expect(service.isFeaturesLocked(church)).toBe(true);
      expect(service.getLockReason(church)).toBe('past_due');
      expect(service.isPublicGivingEntitled(church)).toBe(true);
    });

    it('past_due past grace: locked and public giving off', () => {
      const church: PolicyChurch = {
        subscriptionStatus: SubscriptionStatus.past_due,
        trialEndsAt: null,
        pastDueSince: new Date(Date.now() - 30 * DAY_MS),
      };
      expect(service.isFeaturesLocked(church)).toBe(true);
      expect(service.isPublicGivingEntitled(church)).toBe(false);
    });

    it('past_due without pastDueSince: public giving off', () => {
      const church: PolicyChurch = {
        subscriptionStatus: SubscriptionStatus.past_due,
        trialEndsAt: null,
        pastDueSince: null,
      };
      expect(service.isPublicGivingEntitled(church)).toBe(false);
    });

    it('canceled: locked, no grace, public giving off', () => {
      const church: PolicyChurch = {
        subscriptionStatus: SubscriptionStatus.canceled,
        trialEndsAt: null,
        pastDueSince: new Date(Date.now() - 1 * DAY_MS),
      };
      expect(service.isFeaturesLocked(church)).toBe(true);
      expect(service.getLockReason(church)).toBe('canceled');
      expect(service.isPublicGivingEntitled(church)).toBe(false);
    });

    it('buildSummary reflects lockReason and trial days', () => {
      const trialing = service.buildSummary({
        subscriptionStatus: SubscriptionStatus.trialing,
        trialEndsAt: new Date(Date.now() + 3 * DAY_MS),
      });
      expect(trialing.featuresLocked).toBe(false);
      expect(trialing.lockReason).toBeNull();
      expect(trialing.trialDaysRemaining).toBeGreaterThanOrEqual(2);

      const canceled = service.buildSummary({
        subscriptionStatus: SubscriptionStatus.canceled,
        trialEndsAt: null,
      });
      expect(canceled.featuresLocked).toBe(true);
      expect(canceled.lockReason).toBe('canceled');
    });

    it('getLockMessage returns distinct copy per reason', () => {
      expect(service.getLockMessage('trial_expired')).toContain('teste');
      expect(service.getLockMessage('past_due')).toContain('pagamento');
      expect(service.getLockMessage('canceled')).toContain('encerrada');
    });
  });
});
