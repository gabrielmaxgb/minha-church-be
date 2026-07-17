import {
  createGivingReceiptToken,
  verifyGivingReceiptToken,
} from './giving-receipt-token';

const DONATION_ID = 'donation_test_abc';
const SECRET = 'unit-test-jwt-secret';
const NOW = 1_700_000_000;

describe('giving-receipt-token', () => {
  it('creates a verifiable token bound to donationId', () => {
    const token = createGivingReceiptToken(DONATION_ID, SECRET, NOW);

    expect(token).toMatch(/^\d+\.[A-Za-z0-9_-]+$/);
    expect(verifyGivingReceiptToken(DONATION_ID, token, SECRET, NOW)).toBe(
      true,
    );
  });

  it('rejects missing or blank tokens', () => {
    expect(
      verifyGivingReceiptToken(DONATION_ID, undefined, SECRET, NOW),
    ).toBe(false);
    expect(verifyGivingReceiptToken(DONATION_ID, '', SECRET, NOW)).toBe(
      false,
    );
    expect(verifyGivingReceiptToken(DONATION_ID, '   ', SECRET, NOW)).toBe(
      false,
    );
  });

  it('rejects token for another donationId', () => {
    const token = createGivingReceiptToken(DONATION_ID, SECRET, NOW);

    expect(
      verifyGivingReceiptToken('donation_other', token, SECRET, NOW),
    ).toBe(false);
  });

  it('rejects token signed with another secret', () => {
    const token = createGivingReceiptToken(DONATION_ID, SECRET, NOW);

    expect(
      verifyGivingReceiptToken(DONATION_ID, token, 'other-secret', NOW),
    ).toBe(false);
  });

  it('rejects tampered signature', () => {
    const token = createGivingReceiptToken(DONATION_ID, SECRET, NOW);
    const [exp, sig] = token.split('.');
    const tampered = `${exp}.${sig.slice(0, -1)}${sig.endsWith('a') ? 'b' : 'a'}`;

    expect(
      verifyGivingReceiptToken(DONATION_ID, tampered, SECRET, NOW),
    ).toBe(false);
  });

  it('rejects malformed tokens', () => {
    expect(
      verifyGivingReceiptToken(DONATION_ID, 'not-a-token', SECRET, NOW),
    ).toBe(false);
    expect(
      verifyGivingReceiptToken(DONATION_ID, 'abc.def.ghi', SECRET, NOW),
    ).toBe(false);
  });

  it('rejects expired tokens (48h TTL)', () => {
    const token = createGivingReceiptToken(DONATION_ID, SECRET, NOW);
    const justExpired = NOW + 60 * 60 * 48 + 1;

    expect(
      verifyGivingReceiptToken(DONATION_ID, token, SECRET, justExpired),
    ).toBe(false);
  });

  it('accepts token until the last second of TTL', () => {
    const token = createGivingReceiptToken(DONATION_ID, SECRET, NOW);
    const lastValidSecond = NOW + 60 * 60 * 48;

    expect(
      verifyGivingReceiptToken(DONATION_ID, token, SECRET, lastValidSecond),
    ).toBe(true);
  });
});
