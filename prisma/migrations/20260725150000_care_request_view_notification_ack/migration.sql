-- AlterTable
ALTER TABLE "care_requests" ADD COLUMN "view_notification_acked_at" TIMESTAMP(3);

-- Existing viewed requests should not appear as brand-new bell notifications.
UPDATE "care_requests"
SET "view_notification_acked_at" = COALESCE("viewed_at", CURRENT_TIMESTAMP)
WHERE "status" = 'viewed';

-- DropIndex
DROP INDEX "care_requests_church_id_requester_member_id_idx";

-- CreateIndex
CREATE INDEX "care_requests_church_id_requester_member_id_status_idx" ON "care_requests"("church_id", "requester_member_id", "status");
