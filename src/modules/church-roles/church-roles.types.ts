import type { ChurchPermission, ChurchRole } from '@prisma/client';

export interface ChurchRoleResponse {
  id: string;
  churchId: string;
  name: string;
  color?: string;
  sortOrder: number;
  isSystem: boolean;
  systemKey?: string;
  singleHolder: boolean;
  permissions: ChurchPermission[];
}

export function toChurchRoleResponse(
  role: ChurchRole & {
    permissions: Array<{ permission: ChurchPermission }>;
  },
): ChurchRoleResponse {
  return {
    id: role.id,
    churchId: role.churchId,
    name: role.name,
    color: role.color ?? undefined,
    sortOrder: role.sortOrder,
    isSystem: role.isSystem,
    systemKey: role.systemKey ?? undefined,
    singleHolder: role.singleHolder,
    permissions: role.permissions.map((entry) => entry.permission),
  };
}
