-- CreateEnum
CREATE TYPE "GivingFundAudience" AS ENUM ('members', 'public');

-- AlterTable
ALTER TABLE "giving_funds" ADD COLUMN "audience" "GivingFundAudience" NOT NULL DEFAULT 'members';

-- Existing funds only supported public checkout — keep links working.
UPDATE "giving_funds" SET "audience" = 'public';

-- AlterTable
ALTER TABLE "giving_donations" ADD COLUMN "donor_member_id" TEXT;

-- CreateIndex
CREATE INDEX "giving_funds_church_id_audience_is_active_idx" ON "giving_funds"("church_id", "audience", "is_active");

-- CreateIndex
CREATE INDEX "giving_donations_donor_member_id_idx" ON "giving_donations"("donor_member_id");

-- AddForeignKey
ALTER TABLE "giving_donations" ADD CONSTRAINT "giving_donations_donor_member_id_fkey" FOREIGN KEY ("donor_member_id") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: treasurer + admin system roles get receivables_manage
INSERT INTO "church_role_permissions" ("role_id", "permission")
SELECT cr.id, 'receivables_manage'::"ChurchPermission"
FROM "church_roles" cr
WHERE cr.system_key IN ('admin', 'treasurer')
ON CONFLICT DO NOTHING;
