-- Parental consent MVP on members (minors < 18 before app access).
ALTER TABLE "members" ADD COLUMN "parental_consent_at" TIMESTAMP(3);
ALTER TABLE "members" ADD COLUMN "parental_consent_by_user_id" TEXT;
ALTER TABLE "members" ADD COLUMN "parental_consent_guardian_member_id" TEXT;
ALTER TABLE "members" ADD COLUMN "parental_consent_guardian_name" TEXT;
ALTER TABLE "members" ADD COLUMN "parental_consent_guardian_email" TEXT;
ALTER TABLE "members" ADD COLUMN "parental_consent_version" TEXT;

ALTER TABLE "members" ADD CONSTRAINT "members_parental_consent_by_user_id_fkey" FOREIGN KEY ("parental_consent_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "members" ADD CONSTRAINT "members_parental_consent_guardian_member_id_fkey" FOREIGN KEY ("parental_consent_guardian_member_id") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "members_church_id_parental_consent_at_idx" ON "members"("church_id", "parental_consent_at");
