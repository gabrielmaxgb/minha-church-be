import { isInternalLoginEmail } from './login-email';

export function resolveUserContactEmail(
  userEmail: string,
  memberProfileEmail?: string | null,
): string | null {
  const profileEmail = memberProfileEmail?.trim().toLowerCase();
  if (profileEmail) {
    return profileEmail;
  }

  const normalizedUserEmail = userEmail.trim().toLowerCase();
  if (!isInternalLoginEmail(normalizedUserEmail)) {
    return normalizedUserEmail;
  }

  return null;
}
