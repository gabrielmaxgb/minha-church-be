export interface UserPermissions {
  members: { manage: boolean };
  ministries: { manage: boolean };
  activities: {
    createChurchWide: boolean;
    ministryIds: string[];
  };
  finances: { access: boolean };
  communication: { access: boolean };
  reports: { access: boolean };
  settings: { access: boolean };
}
