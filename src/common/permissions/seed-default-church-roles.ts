import { randomBytes } from 'node:crypto';

import type { Prisma, PrismaClient } from '@prisma/client';

import { DEFAULT_CHURCH_ROLE_TEMPLATES } from './church-permissions.constants';

function createRoleId(churchId: string, systemKey: string): string {
  return `crole_${churchId}_${systemKey}`;
}

/**
 * Cria/atualiza os cargos padrão da igreja com poucos round-trips.
 * A versão anterior fazia upsert + delete + createMany por cargo (~18 queries)
 * e estourava o timeout da transaction interativa no Railway→Neon
 * ("Transaction not found").
 */
export async function seedDefaultChurchRoles(
  prisma: PrismaClient | Prisma.TransactionClient,
  churchId: string,
): Promise<void> {
  const roles = DEFAULT_CHURCH_ROLE_TEMPLATES.map((template) => ({
    id: createRoleId(churchId, template.systemKey),
    churchId,
    name: template.name,
    sortOrder: template.sortOrder,
    isSystem: true,
    systemKey: template.systemKey,
  }));

  await prisma.churchRole.createMany({
    data: roles,
    skipDuplicates: true,
  });

  const roleIds = roles.map((role) => role.id);

  await prisma.churchRolePermission.deleteMany({
    where: { roleId: { in: roleIds } },
  });

  const permissions = DEFAULT_CHURCH_ROLE_TEMPLATES.flatMap((template) =>
    template.permissions.map((permission) => ({
      roleId: createRoleId(churchId, template.systemKey),
      permission,
    })),
  );

  if (permissions.length > 0) {
    await prisma.churchRolePermission.createMany({
      data: permissions,
      skipDuplicates: true,
    });
  }
}

export function createCustomChurchRoleId(): string {
  const suffix = randomBytes(12).toString('base64url');

  return `crole_${suffix}`;
}
