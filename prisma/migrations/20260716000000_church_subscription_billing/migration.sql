-- CreateEnum (idempotent)
DO $$ BEGIN
  CREATE TYPE "SubscriptionStatus" AS ENUM ('trialing', 'active', 'past_due', 'canceled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable
ALTER TABLE "churches"
ADD COLUMN IF NOT EXISTS "subscription_status" "SubscriptionStatus" NOT NULL DEFAULT 'trialing',
ADD COLUMN IF NOT EXISTS "trial_ends_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "stripe_customer_id" TEXT,
ADD COLUMN IF NOT EXISTS "stripe_subscription_id" TEXT,
ADD COLUMN IF NOT EXISTS "stripe_price_id" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "stripe_webhook_events" (
    "id" TEXT NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stripe_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "churches_stripe_customer_id_key" ON "churches"("stripe_customer_id");

-- Backfill trial for existing churches
UPDATE "churches"
SET "trial_ends_at" = NOW() + INTERVAL '30 days'
WHERE "trial_ends_at" IS NULL;
