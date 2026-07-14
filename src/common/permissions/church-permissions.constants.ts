import { ChurchPermission } from '@prisma/client';

export { ChurchPermission };

export const SECTION_ACCESS_PERMISSIONS: readonly ChurchPermission[] = [
  ChurchPermission.dashboard_access,
  ChurchPermission.members_access,
  ChurchPermission.ministries_access,
  ChurchPermission.activities_access,
  ChurchPermission.schedules_access,
  ChurchPermission.finances_access,
  ChurchPermission.communication_access,
  ChurchPermission.reports_access,
  ChurchPermission.settings_access,
] as const;

export const ADMIN_ACTION_PERMISSIONS: readonly ChurchPermission[] = [
  ChurchPermission.members_manage,
  ChurchPermission.ministries_manage,
  ChurchPermission.events_create_church_wide,
  ChurchPermission.communication_manage,
  ChurchPermission.roles_manage,
  ChurchPermission.memberships_manage,
  ChurchPermission.counseling_receive,
  ChurchPermission.receivables_manage,
] as const;

export const ALL_CHURCH_PERMISSIONS: readonly ChurchPermission[] = [
  ...SECTION_ACCESS_PERMISSIONS,
  ...ADMIN_ACTION_PERMISSIONS,
] as const;

export interface ChurchPermissionGroup {
  id: 'sections' | 'actions';
  label: string;
  permissions: readonly ChurchPermission[];
}

export const CHURCH_PERMISSION_GROUPS: readonly ChurchPermissionGroup[] = [
  {
    id: 'sections',
    label: 'Acesso às seções',
    permissions: SECTION_ACCESS_PERMISSIONS,
  },
  {
    id: 'actions',
    label: 'Ações administrativas',
    permissions: ADMIN_ACTION_PERMISSIONS,
  },
] as const;

const MEMBER_SECTION_ACCESS: readonly ChurchPermission[] = [
  ChurchPermission.dashboard_access,
  ChurchPermission.ministries_access,
  ChurchPermission.activities_access,
  ChurchPermission.schedules_access,
];

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
        ...SECTION_ACCESS_PERMISSIONS,
        ChurchPermission.members_manage,
        ChurchPermission.ministries_manage,
        ChurchPermission.events_create_church_wide,
        ChurchPermission.communication_manage,
        ChurchPermission.memberships_manage,
        ChurchPermission.counseling_receive,
      ],
    },
    {
      systemKey: 'secretary',
      name: 'Secretário',
      sortOrder: 30,
      permissions: [
        ChurchPermission.dashboard_access,
        ChurchPermission.members_access,
        ChurchPermission.ministries_access,
        ChurchPermission.activities_access,
        ChurchPermission.communication_access,
        ChurchPermission.communication_manage,
        ChurchPermission.members_manage,
      ],
    },
    {
      systemKey: 'treasurer',
      name: 'Tesoureiro',
      sortOrder: 40,
      permissions: [
        ChurchPermission.dashboard_access,
        ChurchPermission.finances_access,
        ChurchPermission.reports_access,
        ChurchPermission.receivables_manage,
      ],
    },
    {
      systemKey: 'leader',
      name: 'Líder',
      sortOrder: 50,
      permissions: [...MEMBER_SECTION_ACCESS],
    },
    {
      systemKey: 'member',
      name: 'Membro/todos',
      sortOrder: 60,
      permissions: [...MEMBER_SECTION_ACCESS],
    },
  ] as const;

export const PERMISSION_TO_USER_PERMISSIONS_KEY: Record<
  ChurchPermission,
  keyof import('../types/user-permissions').UserPermissions | null
> = {
  [ChurchPermission.dashboard_access]: 'dashboard',
  [ChurchPermission.members_access]: 'members',
  [ChurchPermission.ministries_access]: 'ministries',
  [ChurchPermission.activities_access]: 'activities',
  [ChurchPermission.schedules_access]: 'schedules',
  [ChurchPermission.members_manage]: 'members',
  [ChurchPermission.ministries_manage]: 'ministries',
  [ChurchPermission.events_create_church_wide]: 'activities',
  [ChurchPermission.finances_access]: 'finances',
  [ChurchPermission.receivables_manage]: 'finances',
  [ChurchPermission.communication_access]: 'communication',
  [ChurchPermission.communication_manage]: 'communication',
  [ChurchPermission.reports_access]: 'reports',
  [ChurchPermission.settings_access]: 'settings',
  [ChurchPermission.roles_manage]: 'roles',
  [ChurchPermission.memberships_manage]: 'memberships',
  [ChurchPermission.counseling_receive]: 'counseling',
};

export const CHURCH_PERMISSION_LABELS: Record<ChurchPermission, string> = {
  [ChurchPermission.dashboard_access]: 'Dashboard',
  [ChurchPermission.members_access]: 'Membros',
  [ChurchPermission.ministries_access]: 'Ministérios',
  [ChurchPermission.activities_access]: 'Eventos e Atividades',
  [ChurchPermission.schedules_access]: 'Minhas escalas',
  [ChurchPermission.finances_access]: 'Finanças',
  [ChurchPermission.communication_access]: 'Quadro de avisos',
  [ChurchPermission.reports_access]: 'Relatórios',
  [ChurchPermission.settings_access]: 'Configurações',
  [ChurchPermission.members_manage]: 'Gerenciar membros',
  [ChurchPermission.ministries_manage]: 'Gerenciar ministérios',
  [ChurchPermission.events_create_church_wide]:
    'Criar atividades em toda a igreja',
  [ChurchPermission.communication_manage]: 'Gerenciar comunicados',
  [ChurchPermission.roles_manage]: 'Gerenciar cargos da igreja',
  [ChurchPermission.memberships_manage]: 'Atribuir cargos a usuários',
  [ChurchPermission.counseling_receive]:
    'Receber pedidos de aconselhamento e visitas',
  [ChurchPermission.receivables_manage]: 'Gerenciar recebimentos',
};
