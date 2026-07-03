import {
  Gender,
  MaritalStatus,
  MemberStatus,
  type Member,
  type MemberMinistry,
  type Ministry,
  type MinistryRole,
} from '@prisma/client';

type MinistryRoleAssignment = {
  ministryRole: MinistryRole;
};

export type MemberWithMinistries = Member & {
  ministryLinks: (MemberMinistry & {
    ministry: Ministry;
    roleAssignments: MinistryRoleAssignment[];
  })[];
};

export interface MemberMinistryRoleSummary {
  id: string;
  name: string;
  canManageEvents: boolean;
}

export interface MemberMinistryLinkResponse {
  id: string;
  ministryId: string;
  ministryName: string;
  roles: MemberMinistryRoleSummary[];
  canManageEvents: boolean;
  startedAt: string | null;
  endedAt: string | null;
}

export interface MemberResponse {
  id: string;
  churchId: string;
  name: string;
  email: string | null;
  cpf: string | null;
  phone: string | null;
  phoneSecondary: string | null;
  birthDate: string | null;
  gender: Gender | null;
  maritalStatus: MaritalStatus | null;
  weddingAnniversary: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  status: MemberStatus;
  visitorSince: string | null;
  baptismDate: string | null;
  membershipDate: string | null;
  userId: string | null;
  ministries: MemberMinistryLinkResponse[];
  createdAt: string;
  updatedAt: string;
}

export interface MemberAccountCredentials {
  login: string;
  temporaryPassword: string;
  mustChangePassword: true;
}

export interface CreateMemberResponse extends MemberResponse {
  account: MemberAccountCredentials;
}

export function formatDate(value: Date | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return value.toISOString().slice(0, 10);
}

function mapMinistryRoles(
  roleAssignments: MinistryRoleAssignment[],
): MemberMinistryRoleSummary[] {
  return roleAssignments
    .map((assignment) => ({
      id: assignment.ministryRole.id,
      name: assignment.ministryRole.name,
      canManageEvents: assignment.ministryRole.canManageEvents,
      sortOrder: assignment.ministryRole.sortOrder,
    }))
    .sort(
      (a, b) =>
        a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'pt-BR'),
    )
    .map(({ id, name, canManageEvents }) => ({ id, name, canManageEvents }));
}

export function toMemberResponse(member: MemberWithMinistries): MemberResponse {
  return {
    id: member.id,
    churchId: member.churchId,
    name: member.name,
    email: member.email,
    cpf: member.cpf,
    phone: member.phone,
    phoneSecondary: member.phoneSecondary,
    birthDate: formatDate(member.birthDate),
    gender: member.gender,
    maritalStatus: member.maritalStatus,
    weddingAnniversary: formatDate(member.weddingAnniversary),
    street: member.street,
    number: member.number,
    complement: member.complement,
    neighborhood: member.neighborhood,
    city: member.city,
    state: member.state,
    zipCode: member.zipCode,
    status: member.status,
    visitorSince: formatDate(member.visitorSince),
    baptismDate: formatDate(member.baptismDate),
    membershipDate: formatDate(member.membershipDate),
    userId: member.userId,
    ministries: member.ministryLinks.map((link) => {
      const roles = mapMinistryRoles(link.roleAssignments);

      return {
        id: link.id,
        ministryId: link.ministryId,
        ministryName: link.ministry.name,
        roles,
        canManageEvents: roles.some((role) => role.canManageEvents),
        startedAt: formatDate(link.startedAt),
        endedAt: formatDate(link.endedAt),
      };
    }),
    createdAt: member.createdAt.toISOString(),
    updatedAt: member.updatedAt.toISOString(),
  };
}

export function parseOptionalDate(value?: string | null): Date | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === '') {
    return null;
  }

  return new Date(`${value}T00:00:00.000Z`);
}
