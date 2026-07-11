-- Backfill system roles with section access (runs after enum values exist).

INSERT INTO "church_role_permissions" ("role_id", "permission")
SELECT cr.id, perm.permission::"ChurchPermission"
FROM "church_roles" cr
CROSS JOIN (
  VALUES
    ('admin', 'dashboard_access'),
    ('admin', 'members_access'),
    ('admin', 'ministries_access'),
    ('admin', 'activities_access'),
    ('admin', 'schedules_access'),
    ('pastor', 'dashboard_access'),
    ('pastor', 'members_access'),
    ('pastor', 'ministries_access'),
    ('pastor', 'activities_access'),
    ('pastor', 'schedules_access'),
    ('secretary', 'dashboard_access'),
    ('secretary', 'members_access'),
    ('secretary', 'ministries_access'),
    ('secretary', 'activities_access'),
    ('treasurer', 'dashboard_access'),
    ('treasurer', 'finances_access'),
    ('treasurer', 'reports_access'),
    ('leader', 'dashboard_access'),
    ('leader', 'ministries_access'),
    ('leader', 'activities_access'),
    ('leader', 'schedules_access'),
    ('member', 'dashboard_access'),
    ('member', 'ministries_access'),
    ('member', 'activities_access'),
    ('member', 'schedules_access')
) AS perm(system_key, permission)
WHERE cr.system_key = perm.system_key
ON CONFLICT DO NOTHING;
