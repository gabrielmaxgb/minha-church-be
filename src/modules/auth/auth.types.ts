import type { UserPermissions } from '../../common/types/user-permissions';

export interface JwtPayload {
  sub: string;
  email: string;
  churchId: string;
}

export interface AuthUserRoleResponse {
  id: string;
  name: string;
  color?: string;
}

export interface AuthUserResponse {
  id: string;
  name: string;
  email: string;
  cpf?: string;
  phone?: string | null;
  isOwner: boolean;
  roles: AuthUserRoleResponse[];
  avatarUrl?: string;
  mustChangePassword: boolean;
  emailVerified: boolean;
}

export interface AuthChurchResponse {
  id: string;
  name: string;
  slug: string;
  memberCount?: number;
}

export interface AuthTokensResponse {
  expiresIn: number;
}

export interface AuthResponse {
  user: AuthUserResponse;
  church: AuthChurchResponse;
  churches: AuthChurchResponse[];
  permissions: UserPermissions;
  tokens: AuthTokensResponse;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}
