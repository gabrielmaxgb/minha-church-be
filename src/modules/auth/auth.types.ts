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
  isOwner: boolean;
  roles: AuthUserRoleResponse[];
  avatarUrl?: string;
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
