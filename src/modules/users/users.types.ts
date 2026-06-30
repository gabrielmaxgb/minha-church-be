import type { UserRole } from '../../common/types/user-role';

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  avatarUrl?: string;
}

export interface ChurchMembershipRecord {
  userId: string;
  churchId: string;
  role: UserRole;
}
