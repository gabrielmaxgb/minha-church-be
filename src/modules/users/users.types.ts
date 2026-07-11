export interface UserRecord {
  id: string;
  name: string;
  email: string;
  cpf?: string;
  passwordHash: string;
  avatarUrl?: string;
  mustChangePassword: boolean;
  emailVerifiedAt?: Date | null;
}

export interface ChurchMembershipRecord {
  userId: string;
  churchId: string;
  isOwner: boolean;
}
