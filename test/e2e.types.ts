export interface E2eMembershipItem {
  userId: string;
  user: { email: string };
  roles: Array<{ id: string }>;
}

export interface E2eLoginResponse {
  user: { email: string };
  church: { id: string; slug?: string };
  tokens: { expiresIn: number; accessToken?: string };
  permissions?: {
    members: { manage: boolean };
    activities: { createChurchWide: boolean };
  };
}
