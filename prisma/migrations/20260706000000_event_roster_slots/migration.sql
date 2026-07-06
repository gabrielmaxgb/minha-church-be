-- CreateTable
CREATE TABLE "event_roster_slots" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_roster_slots_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "event_roster_assignments" ADD COLUMN "roster_slot_id" TEXT;

-- Backfill slots from existing assignments
INSERT INTO "event_roster_slots" ("id", "event_id", "label", "sort_order", "created_at", "updated_at")
SELECT
    md5(grouped.event_id || ':' || grouped.role_label),
    grouped.event_id,
    grouped.role_label,
    grouped.row_num - 1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM (
    SELECT
        era.event_id,
        era.role_label,
        ROW_NUMBER() OVER (
            PARTITION BY era.event_id
            ORDER BY era.role_label ASC
        ) AS row_num
    FROM "event_roster_assignments" AS era
    GROUP BY era.event_id, era.role_label
) AS grouped;

UPDATE "event_roster_assignments" AS era
SET "roster_slot_id" = ers.id
FROM "event_roster_slots" AS ers
WHERE ers.event_id = era.event_id
  AND ers.label = era.role_label;

-- Remove assignments that could not be linked (should not happen)
DELETE FROM "event_roster_assignments" WHERE "roster_slot_id" IS NULL;

-- Make roster_slot_id required
ALTER TABLE "event_roster_assignments" ALTER COLUMN "roster_slot_id" SET NOT NULL;

-- CreateIndex
CREATE INDEX "event_roster_slots_event_id_idx" ON "event_roster_slots"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "event_roster_slots_event_id_label_key" ON "event_roster_slots"("event_id", "label");

-- CreateIndex
CREATE UNIQUE INDEX "event_roster_assignments_event_id_roster_slot_id_key" ON "event_roster_assignments"("event_id", "roster_slot_id");

-- AddForeignKey
ALTER TABLE "event_roster_slots" ADD CONSTRAINT "event_roster_slots_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "ministry_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_roster_assignments" ADD CONSTRAINT "event_roster_assignments_roster_slot_id_fkey" FOREIGN KEY ("roster_slot_id") REFERENCES "event_roster_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
