export interface UserRecord {
  id: string;
  name: string;
  email: string;
  cpf?: string;
  passwordHash: string;
  avatarUrl?: string;
  mustChangePassword: boolean;
}

export interface ChurchMembershipRecord {
  userId: string;
  churchId: string;
  isOwner: boolean;
}
