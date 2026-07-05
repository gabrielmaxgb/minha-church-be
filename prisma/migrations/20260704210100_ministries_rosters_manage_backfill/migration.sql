INSERT INTO "church_role_permissions" ("role_id", "permission")
SELECT cr.id, 'ministries_rosters_manage'::"ChurchPermission"
FROM "church_roles" cr
WHERE cr.system_key IN ('admin', 'pastor', 'leader')
ON CONFLICT DO NOTHING;
