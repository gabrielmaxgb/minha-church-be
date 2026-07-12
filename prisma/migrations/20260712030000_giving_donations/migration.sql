-- CreateEnum
CREATE TYPE "GivingDonationStatus" AS ENUM ('pending', 'processing', 'succeeded', 'failed', 'canceled', 'refunded');

-- CreateTable
CREATE TABLE "giving_donations" (
    "id" TEXT NOT NULL,
    "church_id" TEXT NOT NULL,
    "fund_id" TEXT NOT NULL,
    "stripe_payment_intent_id" TEXT,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'brl',
    "status" "GivingDonationStatus" NOT NULL DEFAULT 'pending',
    "payer_name" TEXT,
    "payer_email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "giving_donations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "giving_donations_stripe_payment_intent_id_key" ON "giving_donations"("stripe_payment_intent_id");

-- CreateIndex
CREATE INDEX "giving_donations_church_id_created_at_idx" ON "giving_donations"("church_id", "created_at");

-- CreateIndex
CREATE INDEX "giving_donations_fund_id_idx" ON "giving_donations"("fund_id");

-- AddForeignKey
ALTER TABLE "giving_donations" ADD CONSTRAINT "giving_donations_church_id_fkey" FOREIGN KEY ("church_id") REFERENCES "churches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "giving_donations" ADD CONSTRAINT "giving_donations_fund_id_fkey" FOREIGN KEY ("fund_id") REFERENCES "giving_funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
