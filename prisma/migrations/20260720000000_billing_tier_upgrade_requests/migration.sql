-- CreateEnum
CREATE TYPE "BillingTierUpgradeRequestStatus" AS ENUM ('pending', 'approved', 'dismissed');

-- CreateTable
CREATE TABLE "billing_tier_upgrade_requests" (
    "id" TEXT NOT NULL,
    "church_id" TEXT NOT NULL,
    "target_tier_id" TEXT NOT NULL,
    "requested_by_user_id" TEXT NOT NULL,
    "status" "BillingTierUpgradeRequestStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),
    "resolved_by_user_id" TEXT,

    CONSTRAINT "billing_tier_upgrade_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_tier_upgrade_staff_notices" (
    "id" TEXT NOT NULL,
    "church_id" TEXT NOT NULL,
    "tier_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_tier_upgrade_staff_notices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_tier_upgrade_staff_notice_reads" (
    "id" TEXT NOT NULL,
    "notice_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "read_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_tier_upgrade_staff_notice_reads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "billing_tier_upgrade_requests_church_id_status_idx" ON "billing_tier_upgrade_requests"("church_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "billing_tier_upgrade_requests_church_id_target_tier_id_key" ON "billing_tier_upgrade_requests"("church_id", "target_tier_id");

-- CreateIndex
CREATE INDEX "billing_tier_upgrade_staff_notices_church_id_created_at_idx" ON "billing_tier_upgrade_staff_notices"("church_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "billing_tier_upgrade_staff_notice_reads_notice_id_user_id_key" ON "billing_tier_upgrade_staff_notice_reads"("notice_id", "user_id");

-- AddForeignKey
ALTER TABLE "billing_tier_upgrade_requests" ADD CONSTRAINT "billing_tier_upgrade_requests_church_id_fkey" FOREIGN KEY ("church_id") REFERENCES "churches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_tier_upgrade_requests" ADD CONSTRAINT "billing_tier_upgrade_requests_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_tier_upgrade_requests" ADD CONSTRAINT "billing_tier_upgrade_requests_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_tier_upgrade_staff_notices" ADD CONSTRAINT "billing_tier_upgrade_staff_notices_church_id_fkey" FOREIGN KEY ("church_id") REFERENCES "churches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_tier_upgrade_staff_notice_reads" ADD CONSTRAINT "billing_tier_upgrade_staff_notice_reads_notice_id_fkey" FOREIGN KEY ("notice_id") REFERENCES "billing_tier_upgrade_staff_notices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_tier_upgrade_staff_notice_reads" ADD CONSTRAINT "billing_tier_upgrade_staff_notice_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
