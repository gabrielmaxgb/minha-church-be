CREATE TABLE IF NOT EXISTS "billing_tier_upgrade_acknowledgments" (
  "id" TEXT NOT NULL,
  "church_id" TEXT NOT NULL,
  "tier_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_tier_upgrade_acknowledgments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "billing_tier_upgrade_acknowledgments_church_id_tier_id_key"
  ON "billing_tier_upgrade_acknowledgments"("church_id", "tier_id");

ALTER TABLE "billing_tier_upgrade_acknowledgments"
  ADD CONSTRAINT "billing_tier_upgrade_acknowledgments_church_id_fkey"
  FOREIGN KEY ("church_id") REFERENCES "churches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "billing_tier_upgrade_acknowledgments"
  ADD CONSTRAINT "billing_tier_upgrade_acknowledgments_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
