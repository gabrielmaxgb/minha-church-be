import {
  billingTierFromMemberCount,
  getBillingTierCatalogEntry,
  isBillingTierUpgrade,
  PRICING_CATALOG,
  wouldUpgradeBillingTier,
} from './billing-plans.config';

describe('billing-plans.config', () => {
  it('maps member counts to billing tiers', () => {
    expect(billingTierFromMemberCount(1)).toBe('ate-100');
    expect(billingTierFromMemberCount(100)).toBe('ate-100');
    expect(billingTierFromMemberCount(101)).toBe('101-300');
    expect(billingTierFromMemberCount(300)).toBe('101-300');
    expect(billingTierFromMemberCount(301)).toBe('301-700');
    expect(billingTierFromMemberCount(701)).toBe('701-plus');
  });

  it('detects tier upgrades when member count crosses breakpoints', () => {
    expect(wouldUpgradeBillingTier(99, 100)).toBe(false);
    expect(wouldUpgradeBillingTier(100, 101)).toBe(true);
    expect(wouldUpgradeBillingTier(300, 301)).toBe(true);
    expect(wouldUpgradeBillingTier(101, 100)).toBe(false);
  });

  it('compares tier ids for upgrades', () => {
    expect(isBillingTierUpgrade('ate-100', '101-300')).toBe(true);
    expect(isBillingTierUpgrade('101-300', 'ate-100')).toBe(false);
    expect(isBillingTierUpgrade('301-700', '301-700')).toBe(false);
  });

  it('exposes a catalog with four tiers and stable ids', () => {
    expect(PRICING_CATALOG.tiers).toHaveLength(4);
    expect(getBillingTierCatalogEntry('101-300').monthlyPrice).toBe(289);
    expect(getBillingTierCatalogEntry('701-plus').yearlyPrice).toBe(5890);
  });
});
