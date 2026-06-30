import { randomBytes } from 'node:crypto';

import type { Prisma, PrismaClient } from '@prisma/client';

import { DEFAULT_CHURCH_ROLE_TEMPLATES } from './church-permissions.constants';

function createRoleId(churchId: string, systemKey: string): string {
  return `crole_${churchId}_${systemKey}`;
}

export async function seedDefaultChurchRoles(
  prisma: PrismaClient | Prisma.TransactionClient,
  churchId: string,
): Promise<void> {
  for (const template of DEFAULT_CHURCH_ROLE_TEMPLATES) {
    const roleId = createRoleId(churchId, template.systemKey);

    await prisma.churchRole.upsert({
      where: { id: roleId },
      update: {
        name: template.name,
        sortOrder: template.sortOrder,
        isSystem: true,
        systemKey: template.systemKey,
      },
      create: {
        id: roleId,
        churchId,
        name: template.name,
        sortOrder: template.sortOrder,
        isSystem: true,
        systemKey: template.systemKey,
        permissions: {
          create: template.permissions.map((permission) => ({ permission })),
        },
      },
    });

    await prisma.churchRolePermission.deleteMany({
      where: { roleId },
    });

    if (template.permissions.length > 0) {
      await prisma.churchRolePermission.createMany({
        data: template.permissions.map((permission) => ({
          roleId,
          permission,
        })),
        skipDuplicates: true,
      });
    }
  }
}

export function createCustomChurchRoleId(): string {
  const suffix = randomBytes(12).toString('base64url');

  return `crole_${suffix}`;
}
