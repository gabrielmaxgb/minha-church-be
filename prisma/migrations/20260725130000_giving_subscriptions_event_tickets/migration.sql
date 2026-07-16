-- CreateEnum
CREATE TYPE "GivingSubscriptionStatus" AS ENUM ('incomplete', 'active', 'past_due', 'canceled');

-- CreateEnum
CREATE TYPE "EventTicketStatus" AS ENUM ('pending', 'succeeded', 'failed', 'canceled', 'refunded');

-- AlterTable
ALTER TABLE "giving_donations" ADD COLUMN "subscription_id" TEXT;

-- AlterTable
ALTER TABLE "ministry_events" ADD COLUMN "price_cents" INTEGER;

-- CreateTable
CREATE TABLE "giving_subscriptions" (
    "id" TEXT NOT NULL,
    "church_id" TEXT NOT NULL,
    "fund_id" TEXT NOT NULL,
    "donor_member_id" TEXT,
    "stripe_subscription_id" TEXT NOT NULL,
    "stripe_customer_id" TEXT,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'brl',
    "status" "GivingSubscriptionStatus" NOT NULL DEFAULT 'incomplete',
    "payer_name" TEXT,
    "payer_email" TEXT,
    "canceled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "giving_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_ticket_purchases" (
    "id" TEXT NOT NULL,
    "church_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "member_id" TEXT,
    "stripe_payment_intent_id" TEXT,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'brl',
    "status" "EventTicketStatus" NOT NULL DEFAULT 'pending',
    "buyer_name" TEXT,
    "buyer_email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_ticket_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "giving_subscriptions_stripe_subscription_id_key" ON "giving_subscriptions"("stripe_subscription_id");

-- CreateIndex
CREATE INDEX "giving_subscriptions_church_id_status_idx" ON "giving_subscriptions"("church_id", "status");

-- CreateIndex
CREATE INDEX "giving_subscriptions_donor_member_id_idx" ON "giving_subscriptions"("donor_member_id");

-- CreateIndex
CREATE INDEX "giving_donations_subscription_id_idx" ON "giving_donations"("subscription_id");

-- CreateIndex
CREATE UNIQUE INDEX "event_ticket_purchases_stripe_payment_intent_id_key" ON "event_ticket_purchases"("stripe_payment_intent_id");

-- CreateIndex
CREATE INDEX "event_ticket_purchases_church_id_event_id_idx" ON "event_ticket_purchases"("church_id", "event_id");

-- CreateIndex
CREATE INDEX "event_ticket_purchases_event_id_status_idx" ON "event_ticket_purchases"("event_id", "status");

-- CreateIndex
CREATE INDEX "event_ticket_purchases_member_id_idx" ON "event_ticket_purchases"("member_id");

-- AddForeignKey
ALTER TABLE "giving_subscriptions" ADD CONSTRAINT "giving_subscriptions_church_id_fkey" FOREIGN KEY ("church_id") REFERENCES "churches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "giving_subscriptions" ADD CONSTRAINT "giving_subscriptions_fund_id_fkey" FOREIGN KEY ("fund_id") REFERENCES "giving_funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "giving_subscriptions" ADD CONSTRAINT "giving_subscriptions_donor_member_id_fkey" FOREIGN KEY ("donor_member_id") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "giving_donations" ADD CONSTRAINT "giving_donations_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "giving_subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_ticket_purchases" ADD CONSTRAINT "event_ticket_purchases_church_id_fkey" FOREIGN KEY ("church_id") REFERENCES "churches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_ticket_purchases" ADD CONSTRAINT "event_ticket_purchases_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "ministry_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_ticket_purchases" ADD CONSTRAINT "event_ticket_purchases_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
