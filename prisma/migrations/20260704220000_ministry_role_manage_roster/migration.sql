DELETE FROM "church_role_permissions"
WHERE permission = 'ministries_rosters_manage'::"ChurchPermission";

ALTER TABLE "ministry_roles"
ADD COLUMN IF NOT EXISTS "can_manage_roster" BOOLEAN NOT NULL DEFAULT false;

UPDATE "ministry_roles" mr
SET "can_manage_roster" = true
FROM "ministries" m
WHERE mr."ministry_id" = m.id
  AND m."has_roster" = true
  AND mr."can_manage_events" = true;
