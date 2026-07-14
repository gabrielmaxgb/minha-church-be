export interface UserPermissions {
  dashboard: { access: boolean };
  members: { access: boolean; manage: boolean };
  ministries: {
    access: boolean;
    manage: boolean;
    rosterMinistryIds: string[];
    teamMinistryIds: string[];
    rolesMinistryIds: string[];
  };
  activities: {
    access: boolean;
    createChurchWide: boolean;
    ministryIds: string[];
  };
  schedules: { access: boolean };
  finances: { access: boolean; manage: boolean };
  communication: { access: boolean; manage: boolean };
  reports: { access: boolean };
  settings: { access: boolean };
  roles: { manage: boolean };
  memberships: { manage: boolean };
  counseling: { receive: boolean };
}
