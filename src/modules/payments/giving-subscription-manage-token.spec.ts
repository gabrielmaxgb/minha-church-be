import { createGivingSubscriptionManageToken } from './giving-subscription-manage-token';
import { verifyGivingSubscriptionManageToken } from './giving-subscription-manage-token';

describe('giving-subscription-manage-token', () => {
  const secret = 'test-secret';
  const subscriptionId = 'sub_test_123';

  it('creates and verifies a valid token', () => {
    const token = createGivingSubscriptionManageToken(subscriptionId, secret);
    expect(
      verifyGivingSubscriptionManageToken(subscriptionId, token, secret),
    ).toBe(true);
  });

  it('rejects wrong subscription id', () => {
    const token = createGivingSubscriptionManageToken(subscriptionId, secret);
    expect(
      verifyGivingSubscriptionManageToken('other_id', token, secret),
    ).toBe(false);
  });

  it('rejects expired token', () => {
    const now = 1_700_000_000;
    const token = createGivingSubscriptionManageToken(
      subscriptionId,
      secret,
      now,
    );
    expect(
      verifyGivingSubscriptionManageToken(
        subscriptionId,
        token,
        secret,
        now + 60 * 60 * 24 * 365 * 3,
      ),
    ).toBe(false);
  });
});
