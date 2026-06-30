import type { UserRole } from '../../common/types/user-role';

export interface ChurchMembershipUserResponse {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
}

export interface ChurchMembershipResponse {
  id: string;
  userId: string;
  churchId: string;
  role: UserRole;
  createdAt: string;
  user: ChurchMembershipUserResponse;
  memberId?: string;
  memberName?: string;
}
