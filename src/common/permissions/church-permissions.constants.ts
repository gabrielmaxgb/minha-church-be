import { ChurchPermission } from '@prisma/client';

export { ChurchPermission };

export const ALL_CHURCH_PERMISSIONS: readonly ChurchPermission[] = [
  ChurchPermission.members_manage,
  ChurchPermission.ministries_manage,
  ChurchPermission.events_create_church_wide,
  ChurchPermission.finances_access,
  ChurchPermission.communication_access,
  ChurchPermission.reports_access,
  ChurchPermission.settings_access,
  ChurchPermission.roles_manage,
  ChurchPermission.memberships_manage,
] as const;

export interface DefaultChurchRoleTemplate {
  systemKey: string;
  name: string;
  sortOrder: number;
  permissions: readonly ChurchPermission[];
}

export const DEFAULT_CHURCH_ROLE_TEMPLATES: readonly DefaultChurchRoleTemplate[] =
  [
    {
      systemKey: 'admin',
      name: 'Administrador',
      sortOrder: 10,
      permissions: ALL_CHURCH_PERMISSIONS,
    },
    {
      systemKey: 'pastor',
      name: 'Pastor',
      sortOrder: 20,
      permissions: [
        ChurchPermission.members_manage,
        ChurchPermission.ministries_manage,
        ChurchPermission.events_create_church_wide,
        ChurchPermission.finances_access,
        ChurchPermission.communication_access,
        ChurchPermission.reports_access,
        ChurchPermission.settings_access,
        ChurchPermission.memberships_manage,
      ],
    },
    {
      systemKey: 'secretary',
      name: 'Secretário',
      sortOrder: 30,
      permissions: [
        ChurchPermission.members_manage,
        ChurchPermission.communication_access,
      ],
    },
    {
      systemKey: 'treasurer',
      name: 'Tesoureiro',
      sortOrder: 40,
      permissions: [
        ChurchPermission.finances_access,
        ChurchPermission.reports_access,
      ],
    },
    {
      systemKey: 'leader',
      name: 'Líder',
      sortOrder: 50,
      permissions: [],
    },
    {
      systemKey: 'member',
      name: 'Membro',
      sortOrder: 60,
      permissions: [],
    },
  ] as const;

export const PERMISSION_TO_USER_PERMISSIONS_KEY: Record<
  ChurchPermission,
  keyof import('../types/user-permissions').UserPermissions | null
> = {
  [ChurchPermission.members_manage]: 'members',
  [ChurchPermission.ministries_manage]: 'ministries',
  [ChurchPermission.events_create_church_wide]: 'activities',
  [ChurchPermission.finances_access]: 'finances',
  [ChurchPermission.communication_access]: 'communication',
  [ChurchPermission.reports_access]: 'reports',
  [ChurchPermission.settings_access]: 'settings',
  [ChurchPermission.roles_manage]: null,
  [ChurchPermission.memberships_manage]: null,
};

export const CHURCH_PERMISSION_LABELS: Record<ChurchPermission, string> = {
  [ChurchPermission.members_manage]: 'Gerenciar membros',
  [ChurchPermission.ministries_manage]: 'Gerenciar ministérios',
  [ChurchPermission.events_create_church_wide]:
    'Criar atividades em toda a igreja',
  [ChurchPermission.finances_access]: 'Acessar finanças',
  [ChurchPermission.communication_access]: 'Acessar comunicação',
  [ChurchPermission.reports_access]: 'Acessar relatórios',
  [ChurchPermission.settings_access]: 'Acessar configurações',
  [ChurchPermission.roles_manage]: 'Gerenciar cargos da igreja',
  [ChurchPermission.memberships_manage]: 'Atribuir cargos a usuários',
};
