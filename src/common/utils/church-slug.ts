import type { Prisma, PrismaClient } from '@prisma/client';

type SlugLookupClient = PrismaClient | Prisma.TransactionClient;

export function slugifyChurchName(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

  return slug.length > 0 ? slug : 'igreja';
}

export async function generateUniqueChurchSlug(
  prisma: SlugLookupClient,
  churchName: string,
): Promise<string> {
  const base = slugifyChurchName(churchName);
  let slug = base;
  let suffix = 0;

  while (await prisma.church.findUnique({ where: { slug }, select: { id: true } })) {
    suffix += 1;
    slug = `${base}-${suffix}`;
  }

  return slug;
}
