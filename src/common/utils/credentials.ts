import { randomBytes } from 'node:crypto';

const TEMP_PASSWORD_CHARSET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export function generateTemporaryPassword(length = 10): string {
  const bytes = randomBytes(length);

  return Array.from(bytes, (byte) => TEMP_PASSWORD_CHARSET[byte % TEMP_PASSWORD_CHARSET.length]).join('');
}
