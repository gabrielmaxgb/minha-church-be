import {
  ANONYMIZED_NAME,
  DATA_RETENTION_DAYS,
  purgeAfterFrom,
  retentionCutoff,
} from './privacy.constants';

describe('privacy.constants', () => {
  it('uses 90-day retention', () => {
    expect(DATA_RETENTION_DAYS).toBe(90);
  });

  it('computes retention cutoff ~90 days ago', () => {
    const now = new Date('2026-07-16T12:00:00.000Z');
    const cutoff = retentionCutoff(now);
    const diffDays =
      (now.getTime() - cutoff.getTime()) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBe(90);
  });

  it('computes purgeAfter ~90 days ahead', () => {
    const now = new Date('2026-07-16T12:00:00.000Z');
    const after = purgeAfterFrom(now);
    const diffDays =
      (after.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBe(90);
  });

  it('exposes anonymized placeholder', () => {
    expect(ANONYMIZED_NAME).toBe('[removido]');
  });
});
