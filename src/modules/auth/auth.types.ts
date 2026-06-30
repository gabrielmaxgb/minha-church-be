import type { UserPermissions } from '../../common/types/user-permissions';
import type { UserRole } from '../../common/types/user-role';

export interface JwtPayload {
  sub: string;
  email: string;
  churchId: string;
  role: UserRole;
}

export interface AuthUserResponse {
  id: string;
  name: string;
  email: string;
  role: UserRole;
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
