-- AlterTable
ALTER TABLE "church_roles" ADD COLUMN "requires_active_member" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "ministry_roles" ADD COLUMN "requires_team_membership" BOOLEAN NOT NULL DEFAULT true;
