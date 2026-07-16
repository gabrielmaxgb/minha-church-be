/** Soft-delete / closure retention before anonymization (days). */
export const DATA_RETENTION_DAYS = 90;

/** Bump when terms or privacy text change in a material way. */
export const LEGAL_DOC_VERSION = '2026-07-16';

/** Bump when DPA text changes. */
export const DPA_VERSION = '2026-07-16';

export const ANONYMIZED_NAME = '[removido]';

export function retentionCutoff(from: Date = new Date()): Date {
  return new Date(from.getTime() - DATA_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

export function purgeAfterFrom(from: Date = new Date()): Date {
  return new Date(from.getTime() + DATA_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}
