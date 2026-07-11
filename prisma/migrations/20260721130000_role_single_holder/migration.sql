-- Replace membership-requirement flags with single-holder exclusivity.

ALTER TABLE "church_roles" DROP COLUMN IF EXISTS "requires_active_member";
ALTER TABLE "church_roles" ADD COLUMN IF NOT EXISTS "single_holder" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "ministry_roles" DROP COLUMN IF EXISTS "requires_team_membership";
ALTER TABLE "ministry_roles" ADD COLUMN IF NOT EXISTS "single_holder" BOOLEAN NOT NULL DEFAULT false;
