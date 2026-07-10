-- AlterTable
ALTER TABLE "ministry_roles" ADD COLUMN "can_manage_team" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ministry_roles" ADD COLUMN "can_manage_roles" BOOLEAN NOT NULL DEFAULT false;
