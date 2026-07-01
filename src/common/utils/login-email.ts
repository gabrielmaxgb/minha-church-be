const INTERNAL_LOGIN_EMAIL_SUFFIX = '@accounts.minhachurch.app';

export function isInternalLoginEmail(email: string): boolean {
  return email.endsWith(INTERNAL_LOGIN_EMAIL_SUFFIX);
}
