-- AlterTable
ALTER TABLE "ministry_events" ALTER COLUMN "ministry_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "ministry_events_church_id_starts_at_idx" ON "ministry_events"("church_id", "starts_at");
