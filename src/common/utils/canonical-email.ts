const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);
const OUTLOOK_DOMAINS = new Set([
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
]);

export function canonicalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  const atIndex = normalized.lastIndexOf('@');

  if (atIndex <= 0 || atIndex === normalized.length - 1) {
    return normalized;
  }

  const localPart = normalized.slice(0, atIndex);
  const domain = normalized.slice(atIndex + 1);

  if (GMAIL_DOMAINS.has(domain)) {
    const withoutTag = localPart.split('+')[0] ?? localPart;
    const withoutDots = withoutTag.replace(/\./g, '');

    return `${withoutDots}@${domain}`;
  }

  if (OUTLOOK_DOMAINS.has(domain)) {
    const withoutTag = localPart.split('+')[0] ?? localPart;

    return `${withoutTag}@${domain}`;
  }

  const withoutTag = localPart.split('+')[0] ?? localPart;

  return `${withoutTag}@${domain}`;
}

export function resolveEmailCanonical(
  email: string,
  enforceCanonical: boolean,
): string {
  const normalized = email.trim().toLowerCase();

  return enforceCanonical ? canonicalizeEmail(normalized) : normalized;
}
