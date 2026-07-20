import {
  canDeleteFinanceAccount,
  financeAccountDeleteBlockReason,
} from './finance-account-delete.policy';

describe('finance-account-delete.policy', () => {
  it('allows delete for custom empty categories', () => {
    expect(
      canDeleteFinanceAccount({
        systemKey: null,
        createdByUserId: 'user_1',
        entryCount: 0,
      }),
    ).toBe(true);
    expect(
      financeAccountDeleteBlockReason({
        systemKey: null,
        createdByUserId: 'user_1',
        entryCount: 0,
      }),
    ).toBeNull();
  });

  it('blocks system accounts', () => {
    expect(
      canDeleteFinanceAccount({
        systemKey: 'tithes',
        createdByUserId: 'user_1',
        entryCount: 0,
      }),
    ).toBe(false);
    expect(
      financeAccountDeleteBlockReason({
        systemKey: 'tithes',
        createdByUserId: 'user_1',
        entryCount: 0,
      }),
    ).toBe('system');
  });

  it('blocks default seed accounts without creator', () => {
    expect(
      canDeleteFinanceAccount({
        systemKey: null,
        createdByUserId: null,
        entryCount: 0,
      }),
    ).toBe(false);
    expect(
      financeAccountDeleteBlockReason({
        systemKey: null,
        createdByUserId: null,
        entryCount: 0,
      }),
    ).toBe('default_seed');
  });

  it('blocks accounts that already have entries', () => {
    expect(
      canDeleteFinanceAccount({
        systemKey: null,
        createdByUserId: 'user_1',
        entryCount: 3,
      }),
    ).toBe(false);
    expect(
      financeAccountDeleteBlockReason({
        systemKey: null,
        createdByUserId: 'user_1',
        entryCount: 3,
      }),
    ).toBe('has_entries');
  });
});
