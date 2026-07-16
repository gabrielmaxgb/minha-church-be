export interface E2eMembershipItem {
  userId: string;
  user: { email: string };
  roles: Array<{ id: string }>;
}

export interface E2eLoginResponse {
  user: { email: string; isOwner?: boolean };
  church: {
    id: string;
    slug?: string;
    subscriptionStatus?: string;
    trialEndsAt?: string | null;
    featuresLocked?: boolean;
    lockReason?: string | null;
  };
  tokens: { expiresIn: number; accessToken?: string };
  permissions?: {
    members: { manage: boolean };
    activities: { createChurchWide: boolean };
    settings?: { access: boolean };
  };
}
