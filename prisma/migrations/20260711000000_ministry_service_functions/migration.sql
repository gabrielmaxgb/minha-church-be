-- CreateTable
CREATE TABLE "ministry_service_functions" (
    "id" TEXT NOT NULL,
    "ministry_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ministry_service_functions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ministry_service_functions_ministry_id_idx" ON "ministry_service_functions"("ministry_id");

-- CreateIndex
CREATE UNIQUE INDEX "ministry_service_functions_ministry_id_label_key" ON "ministry_service_functions"("ministry_id", "label");

-- AddForeignKey
ALTER TABLE "ministry_service_functions" ADD CONSTRAINT "ministry_service_functions_ministry_id_fkey" FOREIGN KEY ("ministry_id") REFERENCES "ministries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "event_roster_assignments" ALTER COLUMN "roster_slot_id" DROP NOT NULL;

-- DropForeignKey
ALTER TABLE "event_roster_assignments" DROP CONSTRAINT "event_roster_assignments_roster_slot_id_fkey";

-- AddForeignKey
ALTER TABLE "event_roster_assignments" ADD CONSTRAINT "event_roster_assignments_roster_slot_id_fkey" FOREIGN KEY ("roster_slot_id") REFERENCES "event_roster_slots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
