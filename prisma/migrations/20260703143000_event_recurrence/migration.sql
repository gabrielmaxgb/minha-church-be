-- CreateEnum
CREATE TYPE "EventRecurrenceFrequency" AS ENUM ('daily', 'weekly', 'monthly', 'yearly');

-- CreateTable
CREATE TABLE "event_recurrence_series" (
    "id" TEXT NOT NULL,
    "church_id" TEXT NOT NULL,
    "ministry_id" TEXT,
    "frequency" "EventRecurrenceFrequency" NOT NULL,
    "interval" INTEGER NOT NULL DEFAULT 1,
    "days_of_week" INTEGER[],
    "end_date" DATE,
    "max_occurrences" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_recurrence_series_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "ministry_events" ADD COLUMN "recurrence_series_id" TEXT;

-- CreateIndex
CREATE INDEX "event_recurrence_series_church_id_idx" ON "event_recurrence_series"("church_id");

-- CreateIndex
CREATE INDEX "ministry_events_recurrence_series_id_idx" ON "ministry_events"("recurrence_series_id");

-- AddForeignKey
ALTER TABLE "ministry_events" ADD CONSTRAINT "ministry_events_recurrence_series_id_fkey" FOREIGN KEY ("recurrence_series_id") REFERENCES "event_recurrence_series"("id") ON DELETE SET NULL ON UPDATE CASCADE;
