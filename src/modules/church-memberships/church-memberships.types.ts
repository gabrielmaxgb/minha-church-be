export interface ChurchMembershipRoleResponse {
  id: string;
  name: string;
  color?: string;
  isSystem: boolean;
}

export interface ChurchMembershipResponse {
  id: string;
  userId: string;
  churchId: string;
  isOwner: boolean;
  canReceiveOwnership: boolean;
  roles: ChurchMembershipRoleResponse[];
  createdAt: string;
  user: {
    id: string;
    name: string;
    email: string;
    avatarUrl?: string;
  };
  memberId?: string;
  memberName?: string;
}
