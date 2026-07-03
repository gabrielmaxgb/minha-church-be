-- CreateTable
CREATE TABLE "member_ministry_roles" (
    "member_ministry_id" TEXT NOT NULL,
    "ministry_role_id" TEXT NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_ministry_roles_pkey" PRIMARY KEY ("member_ministry_id","ministry_role_id")
);

-- MigrateData
INSERT INTO "member_ministry_roles" ("member_ministry_id", "ministry_role_id", "assigned_at")
SELECT "id", "ministry_role_id", CURRENT_TIMESTAMP
FROM "member_ministries"
WHERE "ministry_role_id" IS NOT NULL;

-- DropForeignKey
ALTER TABLE "member_ministries" DROP CONSTRAINT "member_ministries_ministry_role_id_fkey";

-- AlterTable
ALTER TABLE "member_ministries" DROP COLUMN "ministry_role_id";

-- AddForeignKey
ALTER TABLE "member_ministry_roles" ADD CONSTRAINT "member_ministry_roles_member_ministry_id_fkey" FOREIGN KEY ("member_ministry_id") REFERENCES "member_ministries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "member_ministry_roles" ADD CONSTRAINT "member_ministry_roles_ministry_role_id_fkey" FOREIGN KEY ("ministry_role_id") REFERENCES "ministry_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
