const SLUG_FALLBACK = 'igreja';
const MAX_SLUG_LENGTH = 60;

export function slugifyChurchName(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH);

  return slug || SLUG_FALLBACK;
}

export function buildUniqueChurchSlug(baseSlug: string, suffix: number): string {
  if (suffix <= 1) {
    return baseSlug;
  }

  const suffixPart = `-${suffix}`;
  const trimmedBase = baseSlug.slice(0, Math.max(1, MAX_SLUG_LENGTH - suffixPart.length));

  return `${trimmedBase}${suffixPart}`;
}
